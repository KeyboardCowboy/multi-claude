'use strict';

// Shares each profile's local session history with Claude's usual data folder (the "hub"), so
// an account's sessions are in the same place whether it is opened through MultiClaude or
// signed into Claude Desktop the normal way.
//
// Claude files this history by account inside a few folders. A profile's own account folder
// inside each is replaced by a link into the hub. Only that account's folder is linked, never
// the whole parent: siblings such as local-agent-mode-sessions/skills-plugin are filed by
// organization and shared between accounts, so they stay per profile. Nothing is deleted.
// Anything in the profile that would collide with the hub is moved to a backup folder.

const fs = require('fs');
const path = require('path');

/** The folders a profile shares for an account: [{ parent, name }] relative to a data folder. */
function sharedFolders(accountId) {
  return [
    { parent: 'claude-code-sessions', name: accountId },
    { parent: 'local-agent-mode-sessions', name: accountId },
    { parent: 'space-memory-copy', name: accountId },
    // This one is filed under the first 8 characters of the account ID.
    { parent: 'spaces-present', name: accountId.slice(0, 8) },
  ];
}

// Moves a file or folder, copying instead when it crosses disks.
function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// Moves everything under `from` into `to` that `to` doesn't already have. Files `to` already
// has (conflicts) are left in `from`. Returns the conflicting paths, relative to `from`.
function mergeInto(from, to, rel = '') {
  const conflicts = [];
  for (const entry of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
    const relPath = path.join(rel, entry.name);
    const src = path.join(from, relPath);
    const dest = path.join(to, relPath);
    const destStat = fs.lstatSync(dest, { throwIfNoEntry: false });
    if (!destStat) move(src, dest);
    else if (entry.isDirectory() && destStat.isDirectory()) conflicts.push(...mergeInto(from, to, relPath));
    else conflicts.push(relPath);
  }
  return conflicts;
}

/** True when any of the account's folders in the profile isn't yet a link into the hub. */
function needsLinking({ profileDir, hubDir, accountId }) {
  return sharedFolders(accountId).some(({ parent, name }) => {
    const local = path.join(profileDir, parent, name);
    const stat = fs.lstatSync(local, { throwIfNoEntry: false });
    return !(stat && stat.isSymbolicLink() && path.resolve(path.dirname(local), fs.readlinkSync(local)) === path.join(hubDir, parent, name));
  });
}

/**
 * How many scheduled tasks a data folder holds for an account, across Claude Code and Cowork.
 * Linking a profile makes the hub's tasks run in it, so this is shown before the first link.
 */
function scheduledTaskCount(dataDir, accountId) {
  let count = 0;
  for (const parent of ['claude-code-sessions', 'local-agent-mode-sessions']) {
    const accountDir = path.join(dataDir, parent, accountId);
    let orgs = [];
    try {
      orgs = fs.readdirSync(accountDir);
    } catch {
      continue;
    }
    for (const org of orgs) {
      try {
        const tasks = JSON.parse(fs.readFileSync(path.join(accountDir, org, 'scheduled-tasks.json'), 'utf8')).scheduledTasks;
        if (Array.isArray(tasks)) count += tasks.length;
      } catch {
        /* no tasks file for this organization */
      }
    }
  }
  return count;
}

/**
 * Links a profile's account folders into the hub. Call only while neither the profile nor any
 * other instance signed into the same account is running. Safe to repeat: correct links are
 * left alone, and anything Claude recreated as a plain folder is merged back in.
 *
 * Returns { linked, conflicts, backupDir }: the folders newly linked, the files that already
 * existed in the hub (the hub's copy is kept), and where the profile's leftovers were put.
 */
function linkAccountFolders({ profileDir, hubDir, accountId, backupDir }) {
  const report = { linked: [], conflicts: [], backupDir: null };
  for (const { parent, name } of sharedFolders(accountId)) {
    const local = path.join(profileDir, parent, name);
    const shared = path.join(hubDir, parent, name);
    const stat = fs.lstatSync(local, { throwIfNoEntry: false });
    if (stat && stat.isSymbolicLink() && path.resolve(path.dirname(local), fs.readlinkSync(local)) === shared) continue;

    fs.mkdirSync(shared, { recursive: true });
    if (stat && stat.isDirectory() && !stat.isSymbolicLink()) {
      const conflicts = mergeInto(local, shared);
      report.conflicts.push(...conflicts.map((c) => path.join(parent, name, c)));
      // What's left (conflicting copies, empty folders) goes to the backup, never deleted.
      move(local, path.join(backupDir, parent, name));
      report.backupDir = backupDir;
    } else if (stat) {
      // A wrong link, or a stray file where the folder should be.
      move(local, path.join(backupDir, parent, name));
      report.backupDir = backupDir;
    }
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.symlinkSync(shared, local, 'dir');
    report.linked.push(path.join(parent, name));
  }
  return report;
}

module.exports = { sharedFolders, needsLinking, scheduledTaskCount, linkAccountFolders };
