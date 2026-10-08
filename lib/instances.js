'use strict';

const os = require('os');
const path = require('path');

// The instance that runs without --user-data-dir (Claude's own default folder).
const DEFAULT_KEY = 'default';

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function normalizeDir(p) {
  return path.resolve(expandHome(String(p).trim()));
}

// A profile's identity: its data folder, or DEFAULT_KEY when it uses Claude's default.
function dirKey(dir) {
  return dir ? normalizeDir(dir) : DEFAULT_KEY;
}

function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'profile'
  );
}

/**
 * Turn the output of `ps -axww -o pid=,command=` into a list of running Claude
 * main processes: [{ pid, key }]. Chromium helper processes (--type=...) are
 * skipped so each running instance appears once.
 */
function parseInstances(psOutput, appPath) {
  const exe = appPath.replace(/\/+$/, '') + '/Contents/MacOS/Claude';
  const found = [];
  for (const line of String(psOutput).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const cmd = m[2];
    if (!(cmd === exe || cmd.startsWith(exe + ' '))) continue;
    if (/\s--type=/.test(cmd)) continue;
    // The value may contain spaces, so read up to the next " --flag" or the end.
    const d = cmd.match(/\s--user-data-dir=(.*?)(?=\s--[A-Za-z]|$)/);
    found.push({ pid: Number(m[1]), key: d ? dirKey(d[1]) : DEFAULT_KEY });
  }
  return found;
}

module.exports = { DEFAULT_KEY, expandHome, normalizeDir, dirKey, slugify, parseInstances };
