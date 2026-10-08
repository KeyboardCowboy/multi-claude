'use strict';

// Which Claude account each profile is signed into, worked out from each data folder's
// config.json. Claude records only an account ID there (no email), so emails are labels the
// user provides once per account and MultiClaude stores separately.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account ID Claude last signed in with, from a data folder's config.json text, or null. */
function accountIdFromConfig(text) {
  try {
    const id = JSON.parse(text).lastKnownAccountUuid;
    return typeof id === 'string' && UUID_RE.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Profiles seen signed in for the first time get that account remembered as theirs, unless
 * another profile is signed into the same account (then the user decides; see accountStates).
 * Mutates the profiles and returns true if any changed.
 */
function bindNewAccounts(profiles, current) {
  let changed = false;
  for (const p of profiles) {
    const id = current.get(p.id);
    if (p.accountId || !id) continue;
    if (profiles.some((o) => o !== p && (current.get(o.id) === id || o.accountId === id))) continue;
    p.accountId = id;
    changed = true;
  }
  return changed;
}

/**
 * Each profile's account situation, by profile id:
 *   { current, expected, kind, sharedWith }
 * kind: 'none'     never signed in here
 *       'ok'       signed into its own account (or the first one seen)
 *       'mismatch' signed into a different account than the one remembered for it
 * sharedWith: ids of other profiles signed into the same account right now.
 */
function accountStates(profiles, current) {
  const states = new Map();
  for (const p of profiles) {
    const id = current.get(p.id) || null;
    const expected = p.accountId || null;
    const kind = !id ? 'none' : expected && expected !== id ? 'mismatch' : 'ok';
    const sharedWith = id ? profiles.filter((o) => o !== p && current.get(o.id) === id).map((o) => o.id) : [];
    states.set(p.id, { current: id, expected, kind, sharedWith });
  }
  return states;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A trimmed, lower-cased email, or null if it doesn't look like one. */
function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

module.exports = { accountIdFromConfig, bindNewAccounts, accountStates, normalizeEmail };
