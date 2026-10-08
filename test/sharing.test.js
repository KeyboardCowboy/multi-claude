'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { linkAccountFolders } = require('../lib/sharing');

const ACCOUNT = '82b35783-4421-4ea2-b0cf-e8022f045eb3';
const ORG = 'a2f28946-8282-49ea-8909-dca4257dcd2e';

// A temporary hub (Claude's usual folder), profile folder, and backup folder.
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multiclaude-sharing-'));
  const dirs = {
    profileDir: path.join(root, 'profile'),
    hubDir: path.join(root, 'hub'),
    backupDir: path.join(root, 'backup'),
    accountId: ACCOUNT,
  };
  fs.mkdirSync(dirs.profileDir);
  fs.mkdirSync(dirs.hubDir);
  return { root, dirs };
}

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const read = (file) => fs.readFileSync(file, 'utf8');

test('links a fresh profile into the hub, and repeating it changes nothing', () => {
  const { dirs } = setup();
  const first = linkAccountFolders(dirs);
  assert.strictEqual(first.linked.length, 4);
  const local = path.join(dirs.profileDir, 'claude-code-sessions', ACCOUNT);
  assert.ok(fs.lstatSync(local).isSymbolicLink());
  assert.strictEqual(fs.realpathSync(local), fs.realpathSync(path.join(dirs.hubDir, 'claude-code-sessions', ACCOUNT)));
  assert.ok(fs.existsSync(path.join(dirs.profileDir, 'spaces-present', ACCOUNT.slice(0, 8))));
  assert.deepStrictEqual(linkAccountFolders(dirs), { linked: [], conflicts: [], backupDir: null });
});

test('moves profile-only sessions into the hub and keeps the hub copy on conflicts', () => {
  const { dirs } = setup();
  const rel = path.join('local-agent-mode-sessions', ACCOUNT, ORG);
  write(path.join(dirs.profileDir, rel, 'local_new.json'), 'profile session');
  write(path.join(dirs.profileDir, rel, 'scheduled-tasks.json'), 'profile tasks (empty)');
  write(path.join(dirs.hubDir, rel, 'scheduled-tasks.json'), 'hub tasks (four)');
  write(path.join(dirs.hubDir, rel, 'local_old.json'), 'hub session');

  const report = linkAccountFolders(dirs);

  // Through the profile's link, both sessions are visible and the hub's task list won.
  assert.strictEqual(read(path.join(dirs.profileDir, rel, 'local_new.json')), 'profile session');
  assert.strictEqual(read(path.join(dirs.profileDir, rel, 'local_old.json')), 'hub session');
  assert.strictEqual(read(path.join(dirs.hubDir, rel, 'scheduled-tasks.json')), 'hub tasks (four)');
  // The losing copy is backed up, not deleted.
  assert.deepStrictEqual(report.conflicts, [path.join(rel, 'scheduled-tasks.json')]);
  assert.strictEqual(read(path.join(dirs.backupDir, rel, 'scheduled-tasks.json')), 'profile tasks (empty)');
});

test('leaves other accounts and organization-filed folders in the profile alone', () => {
  const { dirs } = setup();
  const skills = path.join(dirs.profileDir, 'local-agent-mode-sessions', 'skills-plugin', ORG, 'cache.json');
  const other = path.join(dirs.profileDir, 'claude-code-sessions', '45acb3c6-827a-44ec-854f-ceb23c3ffb9b', 'x.json');
  write(skills, 'skills');
  write(other, 'other account');
  linkAccountFolders(dirs);
  assert.strictEqual(read(skills), 'skills');
  assert.ok(!fs.lstatSync(path.dirname(path.dirname(skills))).isSymbolicLink());
  assert.strictEqual(read(other), 'other account');
});

test('re-merges a folder Claude recreated in place of the link', () => {
  const { dirs } = setup();
  linkAccountFolders(dirs);
  const local = path.join(dirs.profileDir, 'claude-code-sessions', ACCOUNT);
  fs.unlinkSync(local);
  write(path.join(local, ORG, 'local_after.json'), 'written after the link broke');
  const report = linkAccountFolders(dirs);
  assert.deepStrictEqual(report.linked, [path.join('claude-code-sessions', ACCOUNT)]);
  assert.strictEqual(read(path.join(dirs.hubDir, 'claude-code-sessions', ACCOUNT, ORG, 'local_after.json')), 'written after the link broke');
});

test('needsLinking and scheduledTaskCount describe what a first link would change', () => {
  const { needsLinking, scheduledTaskCount } = require('../lib/sharing');
  const { dirs } = setup();
  const tasks = (n) => JSON.stringify({ scheduledTasks: Array.from({ length: n }, (_, i) => ({ id: i })) });
  write(path.join(dirs.hubDir, 'local-agent-mode-sessions', ACCOUNT, ORG, 'scheduled-tasks.json'), tasks(4));
  write(path.join(dirs.hubDir, 'claude-code-sessions', ACCOUNT, ORG, 'scheduled-tasks.json'), tasks(0));
  write(path.join(dirs.hubDir, 'claude-code-sessions', ACCOUNT, 'other-org', 'scheduled-tasks.json'), 'not json');
  assert.strictEqual(scheduledTaskCount(dirs.hubDir, ACCOUNT), 4);
  assert.strictEqual(scheduledTaskCount(dirs.profileDir, ACCOUNT), 0);
  assert.strictEqual(needsLinking(dirs), true);
  linkAccountFolders(dirs);
  assert.strictEqual(needsLinking(dirs), false);
});
