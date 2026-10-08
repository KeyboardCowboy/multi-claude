'use strict';

const api = window.multiclaude;

const SWATCHES = [
  ['Indigo', '#4452C8'],
  ['Teal', '#0F7F76'],
  ['Berry', '#B3315F'],
  ['Violet', '#7A47C9'],
  ['Green', '#3D7F2C'],
  ['Rust', '#B5521B'],
  ['Gold', '#8F6A0B'],
  ['Graphite', '#4F5664'],
];

const $ = (sel, root = document) => root.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Small DOM builder. Text always goes in as text nodes, never as HTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'vars') for (const [k, v] of Object.entries(value)) node.style.setProperty(k, v);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function initialOf(name) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(claude|for|the|my|a|an|of)$/i.test(w));
  return ((words[0] || name.trim() || '?')[0] || '?').toUpperCase();
}

// ------------------------------------------------------------------ state

let state = { profiles: [], appFound: true, claudeAppPath: '' };
let iconUrl = null;
let iconFor = null;
let structureKey = '';

async function refresh({ force = false } = {}) {
  state = await api.getState();
  if (iconFor !== state.claudeAppPath) {
    iconUrl = await api.getIcon();
    iconFor = state.claudeAppPath;
    force = true;
  }
  const key = JSON.stringify([
    state.profiles.map(({ running, ...rest }) => rest),
    state.appFound,
    state.claudeAppPath,
  ]);
  if (force || key !== structureKey) {
    structureKey = key;
    render();
  } else {
    patchStatus();
  }
}

// ------------------------------------------------------------------ grid

function render() {
  closeMenu();
  const grid = $('#grid');
  grid.replaceChildren(...state.profiles.map(tile), addTile());
  $('#appPath').textContent = state.claudeAppPath;
  renderBanner();
  patchStatus();
}

function renderBanner() {
  const banner = $('#banner');
  banner.replaceChildren();
  banner.hidden = state.appFound;
  if (state.appFound) return;
  banner.append(
    el('span', { text: `Claude isn’t installed at ${state.claudeAppPath}.` }),
    el('button', { class: 'btn', type: 'button', onClick: chooseApp, text: 'Choose Claude.app…' }),
  );
}

function tile(p) {
  const letter = initialOf(p.name);
  const plate = iconUrl
    ? el('span', { class: 'plate' }, el('img', { src: iconUrl, alt: '' }), el('span', { class: 'badge', 'aria-hidden': 'true', text: letter }))
    : el('span', { class: 'plate glyph', 'aria-hidden': 'true', text: letter });

  const launch = el(
    'button',
    { class: 'launch', type: 'button', onClick: () => launchProfile(p) },
    plate,
    el('span', { class: 'name', text: p.name }),
    el('span', { class: 'status', 'data-role': 'status' }),
  );

  const more = el('button', {
    class: 'more',
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': `Options for ${p.name}`,
    text: '⋯',
    onClick: (e) => toggleMenu(e, p, li, more),
  });

  const li = el('li', { class: 'tile', 'data-id': p.id, vars: { '--c': p.color } }, launch, more);
  return li;
}

function addTile() {
  return el(
    'li',
    { class: 'tile' },
    el(
      'button',
      { class: 'launch', type: 'button', onClick: () => openEdit(null) },
      el('span', { class: 'plate add', 'aria-hidden': 'true', text: '+' }),
      el('span', { class: 'name', text: 'Add profile' }),
      el('span', { class: 'status' }),
    ),
  );
}

// ------------------------------------------------------------------ status

// How long a launch may take before "Starting…" turns into "Didn't start".
const START_TIMEOUT_MS = 20000;

// Renderer-only states layered over the main process's running flag, by profile id:
// { kind: 'starting', since } after a launch, or { kind: 'error', label } when one fails.
const transient = new Map();

// The status shown on a tile: { kind: 'running' | 'starting' | 'error' | 'off', label }.
function statusOf(p) {
  if (p.running) {
    transient.delete(p.id);
    return { kind: 'running', label: 'Running' };
  }
  if (!state.appFound) return { kind: 'error', label: 'Claude not found' };
  const t = transient.get(p.id);
  if (t && t.kind === 'starting') {
    if (Date.now() - t.since < START_TIMEOUT_MS) return { kind: 'starting', label: 'Starting…' };
    transient.set(p.id, { kind: 'error', label: 'Didn’t start' });
  }
  return transient.get(p.id) || { kind: 'off', label: 'Not running' };
}

function patchStatus() {
  for (const p of state.profiles) {
    const li = $(`.tile[data-id="${CSS.escape(p.id)}"]`);
    if (!li) continue;
    const status = $('[data-role="status"]', li);
    const { kind, label } = statusOf(p);
    status.dataset.status = kind;
    status.textContent = label;
  }
}

// Show "Starting…" on a profile that isn't running yet; returns the launch result.
async function launchWithStatus(id) {
  const p = state.profiles.find((x) => x.id === id);
  if (p && !p.running) transient.set(id, { kind: 'starting', since: Date.now() });
  patchStatus();
  const r = await api.launch(id);
  if (!r.ok) transient.set(id, { kind: 'error', label: 'Couldn’t open' });
  patchStatus();
  return r;
}

async function launchProfile(p) {
  // A running profile is just brought forward, so it stays "Running".
  const r = await launchWithStatus(p.id);
  if (!r.ok) return toast(r.error || 'Could not open Claude.', true);
  toast(`Opening ${p.name}…`);
  setTimeout(refresh, 1500);
  setTimeout(refresh, 4000);
}

async function chooseApp() {
  const r = await api.chooseClaudeApp();
  if (r.error) toast(r.error, true);
  if (r.ok) refresh({ force: true });
}

// ------------------------------------------------------------------ per-profile menu

let openMenu = null;

function closeMenu() {
  if (!openMenu) return;
  openMenu.menu.remove();
  openMenu.button.setAttribute('aria-expanded', 'false');
  openMenu = null;
}

function toggleMenu(event, p, li, button) {
  event.stopPropagation();
  const wasOpen = openMenu && openMenu.button === button;
  closeMenu();
  if (wasOpen) return;

  const item = (label, fn, cls = '') =>
    el('button', {
      class: `menu-item ${cls}`.trim(),
      type: 'button',
      role: 'menuitem',
      text: label,
      onClick: () => {
        closeMenu();
        fn();
      },
    });

  const menu = el(
    'div',
    { class: 'menu', role: 'menu' },
    item('Sign in or connect…', () => openWizard(p)),
    item('Edit…', () => openEdit(p)),
    item('Remove…', () => openRemove(p), 'danger'),
  );
  li.append(menu);
  placeMenu(menu, button);
  button.setAttribute('aria-expanded', 'true');
  openMenu = { menu, button };
  menu.querySelector('button').focus();
}

// Pin the menu under the ⋯ button, right edges aligned, but keep it inside the
// window: slide it sideways at the edges and flip it above when there's no room below.
function placeMenu(menu, button) {
  const MARGIN = 8;
  const GAP = 4;
  const b = button.getBoundingClientRect();
  const { width, height } = menu.getBoundingClientRect();
  const maxLeft = window.innerWidth - width - MARGIN;
  const left = Math.max(MARGIN, Math.min(b.right - width, maxLeft));
  const below = b.bottom + GAP;
  const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, b.top - GAP - height);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

document.addEventListener('click', closeMenu);
window.addEventListener('resize', closeMenu);
document.addEventListener('scroll', closeMenu, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenu) {
    const { button } = openMenu;
    closeMenu();
    button.focus();
  }
});

// ------------------------------------------------------------------ toast

let toastTimer;
function toast(message, isError = false) {
  const t = $('#toast');
  t.textContent = message;
  t.dataset.error = String(isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
}

function showError(id, message) {
  const box = $(id);
  box.hidden = !message;
  box.textContent = message || '';
}

// ------------------------------------------------------------------ add / edit

const edit = { id: null, color: SWATCHES[0][1], dirEdited: false };

function renderSwatches() {
  const box = $('#swatches');
  box.replaceChildren();
  for (const [label, hex] of SWATCHES) {
    const id = `swatch-${label}`;
    box.append(
      el('input', {
        type: 'radio',
        name: 'color',
        id,
        value: hex,
        class: 'sr-only',
        checked: hex === edit.color,
        onChange: () => {
          edit.color = hex;
        },
      }),
      el('label', { for: id, class: 'swatch', title: label, vars: { '--c': hex } }, el('span', { class: 'sr-only', text: label })),
    );
  }
}

function syncFolderControls() {
  const useDefault = $('#useDefault').checked;
  $('#dirInput').disabled = useDefault;
  $('#chooseDir').disabled = useDefault;
}

function openEdit(p) {
  edit.id = p ? p.id : null;
  edit.dirEdited = !!(p && p.dir);
  const used = new Set(state.profiles.map((x) => x.color));
  edit.color = p ? p.color : (SWATCHES.find(([, hex]) => !used.has(hex)) || SWATCHES[0])[1];

  $('#editTitle').textContent = p ? 'Edit profile' : 'Add profile';
  $('#nameInput').value = p ? p.name : '';
  $('#dirInput').value = p && p.dir ? p.dir : '';
  const defaultTaken = state.profiles.some((x) => x.dir === null && (!p || x.id !== p.id));
  $('#useDefault').checked = !!p && p.dir === null;
  $('#useDefault').disabled = defaultTaken;
  renderSwatches();
  syncFolderControls();
  showError('#editError', '');
  $('#editDialog').showModal();
  $('#nameInput').focus();
}

$('#nameInput').addEventListener('input', async () => {
  if (edit.dirEdited || $('#useDefault').checked) return;
  const name = $('#nameInput').value.trim();
  $('#dirInput').value = name ? await api.suggestDir(name) : '';
});
$('#dirInput').addEventListener('input', () => {
  edit.dirEdited = true;
});
$('#useDefault').addEventListener('change', syncFolderControls);
$('#chooseDir').addEventListener('click', async () => {
  const dir = await api.chooseDir();
  if (dir) {
    $('#dirInput').value = dir;
    edit.dirEdited = true;
  }
});
$('#editCancel').addEventListener('click', () => $('#editDialog').close());
$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api.saveProfile({
    id: edit.id,
    name: $('#nameInput').value,
    color: edit.color,
    useDefaultFolder: $('#useDefault').checked,
    dir: $('#dirInput').value,
  });
  if (!r.ok) return showError('#editError', r.error);
  $('#editDialog').close();
  refresh({ force: true });
});

// ------------------------------------------------------------------ remove

let removing = null;

function openRemove(p) {
  removing = p;
  $('#removeText').textContent = `Remove “${p.name}” from MultiClaude? The Claude account itself isn’t affected.`;
  const trash = $('#trashData');
  trash.checked = false;
  showError('#removeError', '');
  const field = $('#trashField');
  field.hidden = !p.dir;
  if (p.dir) {
    trash.disabled = !!p.running;
    $('#trashHint').textContent = p.running
      ? 'Quit this profile first to delete its folder.'
      : 'This signs the account out on this Mac. The folder goes to the Trash, so you can restore it.';
  }
  $('#removeDialog').showModal();
}

$('#removeCancel').addEventListener('click', () => $('#removeDialog').close());
$('#removeConfirm').addEventListener('click', async () => {
  const r = await api.removeProfile(removing.id, $('#trashData').checked);
  if (!r.ok) return showError('#removeError', r.error);
  $('#removeDialog').close();
  refresh({ force: true });
});

// ------------------------------------------------------------------ sign in / connect

let wizard = null;

async function openWizard(p) {
  const others = await api.othersRunning(p.id);
  wizard = {
    profile: p,
    step: others.length ? 0 : 1,
    others,
    remaining: [],
    quitIds: [],
    busy: false,
    browserReady: false,
    summaries: others.length ? {} : { 0: 'No other Claude instances were running.' },
  };
  $('#wizardSub').textContent = p.name;
  showError('#wizardError', '');
  renderWizard();
  $('#wizardDialog').showModal();
}

function advance(to, summary) {
  if (summary) wizard.summaries[wizard.step] = summary;
  wizard.step = to;
  renderWizard();
}

async function quitOthers(force) {
  wizard.busy = true;
  renderWizard();
  const r = await api.quitOthers(wizard.profile.id, force);
  wizard.busy = false;
  if (!r.ok) {
    showError('#wizardError', r.error);
    return renderWizard();
  }
  wizard.quitIds = [...new Set([...wizard.quitIds, ...r.quitIds])];
  wizard.remaining = r.remaining;
  if (r.remaining.length) return renderWizard();
  advance(1, 'Other instances closed.');
}

async function openTarget() {
  wizard.busy = true;
  renderWizard();
  const r = await launchWithStatus(wizard.profile.id);
  wizard.busy = false;
  if (!r.ok) {
    showError('#wizardError', r.error);
    return renderWizard();
  }
  showError('#wizardError', '');
  advance(3, `${wizard.profile.name} opened.`);
  setTimeout(refresh, 2000);
}

async function reopenClosed() {
  wizard.busy = true;
  renderWizard();
  for (const id of wizard.quitIds) {
    await launchWithStatus(id);
    await sleep(800);
  }
  wizard.quitIds = [];
  wizard.busy = false;
  renderWizard();
  setTimeout(refresh, 2000);
}

function renderWizard() {
  const w = wizard;
  const name = w.profile.name;
  const btn = (label, onClick, cls = 'primary', disabled = false) =>
    el('button', { class: `btn ${cls}`, type: 'button', onClick, text: label, disabled: disabled || w.busy });

  const steps = [
    {
      title: 'Close your other Claude instances',
      body: () => [
        el('p', { text: 'Sign-in links open whichever Claude instance macOS picks, so only one should be running.' }),
        el('ul', { class: 'plain' }, w.others.map((o) => el('li', { text: o.label }))),
        w.remaining.length
          ? el('p', { class: 'warn', text: `Still running: ${w.remaining.join(', ')}. Save anything in progress, then force quit.` })
          : el('p', { class: 'hint', text: 'Quitting closes them right away, and unsent text in their windows may be lost.' }),
        el('div', { class: 'actions' }, w.remaining.length ? btn('Force quit', () => quitOthers(true), 'danger') : btn('Quit them', () => quitOthers(false))),
      ],
    },
    {
      title: 'Check your browser',
      body: () => [
        el('p', { text: `Sign-in and service connections finish in your default browser. Make sure it is signed in to the Claude account you want for “${name}”, or sign out there first.` }),
        el(
          'label',
          { class: 'check' },
          el('input', {
            type: 'checkbox',
            checked: w.browserReady,
            onChange: (e) => {
              w.browserReady = e.target.checked;
              renderWizard();
              $('#steps input[type="checkbox"]').focus();
            },
          }),
          el('span', { text: 'My browser is signed in to the right account' }),
        ),
        el('div', { class: 'actions' }, btn('Continue', () => advance(2, 'Browser checked.'), 'primary', !w.browserReady)),
      ],
    },
    {
      title: `Open ${name}`,
      body: () => [
        el('p', { text: 'This starts a fresh instance for the profile, with only that one running.' }),
        el('div', { class: 'actions' }, btn(`Open ${name}`, openTarget)),
      ],
    },
    {
      title: 'Finish in the app',
      body: () => [
        el('p', { text: 'Click Sign in (or Connect on a service), finish in the browser, and approve the prompt to return to Claude. Then check that the app shows the account you expect.' }),
        el(
          'div',
          { class: 'actions' },
          w.quitIds.length ? btn('Reopen closed profiles', reopenClosed, '') : null,
          btn('Done', () => {
            $('#wizardDialog').close();
            refresh({ force: true });
          }),
        ),
      ],
    },
  ];

  $('#steps').replaceChildren(
    ...steps.map((s, i) => {
      const st = i < w.step ? 'done' : i === w.step ? 'active' : 'todo';
      return el(
        'li',
        { class: 'step', 'data-state': st, 'aria-current': st === 'active' ? 'step' : false },
        el('span', { class: 'marker', 'aria-hidden': 'true', text: st === 'done' ? '✓' : String(i + 1) }),
        el(
          'div',
          { class: 'step-main' },
          el('h3', { text: s.title }),
          st === 'active' ? el('div', { class: 'body' }, s.body()) : null,
          st === 'done' && w.summaries[i] ? el('p', { class: 'summary', text: w.summaries[i] }) : null,
        ),
      );
    }),
  );
}

$('#wizardClose').addEventListener('click', () => {
  $('#wizardDialog').close();
  refresh({ force: true });
});
$('#changeApp').addEventListener('click', chooseApp);

// ------------------------------------------------------------------ boot

refresh({ force: true });
setInterval(() => {
  if (!document.hidden) refresh();
}, 2500);
