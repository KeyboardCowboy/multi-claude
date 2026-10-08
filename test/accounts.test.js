'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { accountIdFromConfig, bindNewAccounts, accountStates, normalizeEmail } = require('../lib/accounts');

const A = '45acb3c6-827a-44ec-854f-ceb23c3ffb9b';
const B = '82b35783-4421-4ea2-b0cf-e8022f045eb3';

test('accountIdFromConfig reads lastKnownAccountUuid and rejects junk', () => {
  assert.strictEqual(accountIdFromConfig(JSON.stringify({ lastKnownAccountUuid: A.toUpperCase() })), A);
  assert.strictEqual(accountIdFromConfig(JSON.stringify({ lastKnownAccountUuid: 'nope' })), null);
  assert.strictEqual(accountIdFromConfig('{}'), null);
  assert.strictEqual(accountIdFromConfig('not json'), null);
});

test('bindNewAccounts remembers a first sign-in, but not one shared with another profile', () => {
  const profiles = [{ id: 'p' }, { id: 'w' }, { id: 'x' }];
  const current = new Map([['p', A], ['w', B], ['x', B]]);
  assert.strictEqual(bindNewAccounts(profiles, current), true);
  assert.strictEqual(profiles[0].accountId, A);
  assert.strictEqual(profiles[1].accountId, undefined);
  assert.strictEqual(profiles[2].accountId, undefined);
});

test('bindNewAccounts never changes an account already remembered', () => {
  const profiles = [{ id: 'p', accountId: A }];
  assert.strictEqual(bindNewAccounts(profiles, new Map([['p', B]])), false);
  assert.strictEqual(profiles[0].accountId, A);
});

test('accountStates spots a different account and accounts open in two profiles', () => {
  const profiles = [{ id: 'p', accountId: A }, { id: 'w', accountId: B }, { id: 'n' }];
  // Personal's folder was signed into the work account the normal way.
  const states = accountStates(profiles, new Map([['p', B], ['w', B]]));
  assert.deepStrictEqual(states.get('p'), { current: B, expected: A, kind: 'mismatch', sharedWith: ['w'] });
  assert.deepStrictEqual(states.get('w'), { current: B, expected: B, kind: 'ok', sharedWith: ['p'] });
  assert.deepStrictEqual(states.get('n'), { current: null, expected: null, kind: 'none', sharedWith: [] });
});

test('normalizeEmail trims, lower-cases, and rejects non-emails', () => {
  assert.strictEqual(normalizeEmail('  You@Work.COM '), 'you@work.com');
  assert.strictEqual(normalizeEmail('you@work'), null);
  assert.strictEqual(normalizeEmail(''), null);
});
