'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_KEY, dirKey, slugify, parseInstances } = require('../lib/instances');

const APP = '/Applications/Claude.app';
const EXE = `${APP}/Contents/MacOS/Claude`;

const PS = [
  `  101 ${EXE}`,
  `  102 ${APP}/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer`,
  `  203 ${EXE} --user-data-dir=/Users/me/.claude-instances/work`,
  `  204 ${EXE} --type=gpu-process --user-data-dir=/Users/me/.claude-instances/work`,
  `  305 ${EXE} --user-data-dir=/Users/me/My Claude Data/work --no-sandbox`,
  `  406 /usr/bin/some-other-process --user-data-dir=/Users/me/.claude-instances/work`,
  `  507 /Applications/Other.app/Contents/MacOS/Claude`,
  '',
].join('\n');

test('finds main processes only, one per instance', () => {
  const found = parseInstances(PS, APP);
  assert.deepStrictEqual(
    found.map((f) => f.pid),
    [101, 203, 305],
  );
});

test('classifies the default instance and custom folders', () => {
  const found = parseInstances(PS, APP);
  assert.strictEqual(found[0].key, DEFAULT_KEY);
  assert.strictEqual(found[1].key, '/Users/me/.claude-instances/work');
});

test('handles data folders that contain spaces', () => {
  const found = parseInstances(PS, APP);
  assert.strictEqual(found[2].key, '/Users/me/My Claude Data/work');
});

test('tolerates a trailing slash on the app path', () => {
  assert.strictEqual(parseInstances(PS, APP + '/').length, 3);
});

test('dirKey expands ~ and treats null as the default', () => {
  assert.strictEqual(dirKey(null), DEFAULT_KEY);
  assert.strictEqual(dirKey('~/x'), path.join(os.homedir(), 'x'));
});

test('slugify makes safe folder names', () => {
  assert.strictEqual(slugify('Work Claude!'), 'work-claude');
  assert.strictEqual(slugify('   '), 'profile');
});
