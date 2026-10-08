'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { normalizeDir, dirKey, slugify, parseInstances } = require('./lib/instances');

app.setName('MultiClaude');

const DEFAULT_APP_PATH = '/Applications/Claude.app';
const CLAUDE_DEFAULT_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
const CLAUDE_CODE_DIR = path.join(os.homedir(), '.claude');
const INSTANCES_ROOT = path.join(os.homedir(), '.claude-instances');
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- storage

let state = null;
const configFile = () => path.join(app.getPath('userData'), 'profiles.json');

async function saveState() {
  await fsp.mkdir(path.dirname(configFile()), { recursive: true });
  await fsp.writeFile(configFile(), JSON.stringify(state, null, 2));
}

// Settings from before the rename to MultiClaude, copied over once on first run.
const LEGACY_CONFIG_FILE = path.join(app.getPath('appData'), 'Claude Switcher', 'profiles.json');

async function migrateLegacyConfig() {
  if (fs.existsSync(configFile()) || !fs.existsSync(LEGACY_CONFIG_FILE)) return;
  await fsp.mkdir(path.dirname(configFile()), { recursive: true });
  await fsp.copyFile(LEGACY_CONFIG_FILE, configFile());
}

async function loadState() {
  try {
    await migrateLegacyConfig();
  } catch {
    /* fall through to defaults */
  }
  try {
    state = JSON.parse(await fsp.readFile(configFile(), 'utf8'));
  } catch {
    state = null;
  }
  if (!state || !Array.isArray(state.profiles)) {
    state = {
      claudeAppPath: DEFAULT_APP_PATH,
      // The default profile keeps whatever account Claude is already signed into.
      profiles: [{ id: 'default', name: 'Personal Claude', color: '#4452C8', dir: null }],
    };
    await saveState();
  }
  if (!state.claudeAppPath) state.claudeAppPath = DEFAULT_APP_PATH;
}

const findProfile = (id) => state.profiles.find((p) => p.id === id);

// ---------------------------------------------------------------- system helpers

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
  });
}

const appFound = () => fs.existsSync(path.join(state.claudeAppPath, 'Contents', 'MacOS'));

async function scanInstances() {
  try {
    const out = await run('/bin/ps', ['-axww', '-o', 'pid=,command=']);
    return parseInstances(out, state.claudeAppPath);
  } catch {
    return [];
  }
}

function labelFor(key) {
  const p = state.profiles.find((x) => dirKey(x.dir) === key);
  return p ? p.name : 'Another Claude instance';
}

function profileIdFor(key) {
  const p = state.profiles.find((x) => dirKey(x.dir) === key);
  return p ? p.id : null;
}

async function othersRunning(id) {
  const target = findProfile(id);
  if (!target) return [];
  const targetKey = dirKey(target.dir);
  return (await scanInstances())
    .filter((i) => i.key !== targetKey)
    .map((i) => ({ key: i.key, label: labelFor(i.key) }));
}

async function quitOthers(id, force) {
  const target = findProfile(id);
  if (!target) return { ok: false, error: 'Profile not found.' };
  const targetKey = dirKey(target.dir);
  const others = (await scanInstances()).filter((i) => i.key !== targetKey);

  for (const inst of others) {
    try {
      process.kill(inst.pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      /* already gone */
    }
  }

  let remaining = others;
  const deadline = Date.now() + (force ? 2500 : 7000);
  while (remaining.length && Date.now() < deadline) {
    await sleep(350);
    const alive = new Set((await scanInstances()).map((i) => i.pid));
    remaining = others.filter((i) => alive.has(i.pid));
  }

  const remainingPids = new Set(remaining.map((i) => i.pid));
  const quit = others.filter((i) => !remainingPids.has(i.pid));
  return {
    ok: true,
    quitIds: quit.map((i) => profileIdFor(i.key)).filter(Boolean),
    remaining: remaining.map((i) => labelFor(i.key)),
  };
}

// Claude's own icon, read from the installed app at runtime (nothing is bundled).
let iconCache = { path: null, url: null };
async function claudeIcon() {
  if (iconCache.path === state.claudeAppPath) return iconCache.url;
  let url = null;
  try {
    const plist = path.join(state.claudeAppPath, 'Contents', 'Info.plist');
    const info = JSON.parse(await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]));
    let file = info.CFBundleIconFile || 'electron.icns';
    if (!file.endsWith('.icns')) file += '.icns';
    const src = path.join(state.claudeAppPath, 'Contents', 'Resources', file);
    const out = path.join(app.getPath('userData'), `icon-${crypto.randomBytes(4).toString('hex')}.png`);
    await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '256', src, '--out', out]);
    url = 'data:image/png;base64,' + (await fsp.readFile(out)).toString('base64');
    fsp.unlink(out).catch(() => {});
  } catch {
    url = null; // the UI falls back to a lettered tile
  }
  iconCache = { path: state.claudeAppPath, url };
  return url;
}

// ---------------------------------------------------------------- validation

function validateProfile(input, existingId) {
  const name = String(input.name || '').trim();
  if (!name) return { error: 'Give the profile a name.' };
  if (name.length > 40) return { error: 'Use a name of 40 characters or fewer.' };
  const others = state.profiles.filter((p) => p.id !== existingId);
  if (others.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return { error: 'Another profile already has that name.' };
  }

  const color = COLOR_RE.test(input.color) ? input.color : '#4452C8';

  if (input.useDefaultFolder) {
    if (others.some((p) => p.dir === null)) {
      return { error: 'Another profile already uses Claude’s default folder. Choose a separate folder for this one.' };
    }
    return { value: { name, color, dir: null } };
  }

  const raw = String(input.dir || '').trim();
  if (!raw) return { error: 'Choose a data folder.' };
  const dir = normalizeDir(raw);
  if (path.dirname(dir) === dir || dir === os.homedir()) {
    return { error: 'Choose a dedicated folder, not your home folder or the disk root.' };
  }
  if (dir === CLAUDE_DEFAULT_DATA) {
    return { error: 'That is Claude’s default folder. Tick “Use Claude’s default folder” instead, or choose another.' };
  }
  if (dir === CLAUDE_CODE_DIR || dir.startsWith(CLAUDE_CODE_DIR + path.sep)) {
    return { error: 'That folder belongs to Claude Code. Choose a different one.' };
  }
  if (others.some((p) => p.dir && dirKey(p.dir) === dir)) {
    return { error: 'Another profile already uses that folder.' };
  }
  return { value: { name, color, dir } };
}

// ---------------------------------------------------------------- IPC

ipcMain.handle('state:get', async () => {
  const running = await scanInstances();
  const keys = new Set(running.map((i) => i.key));
  return {
    claudeAppPath: state.claudeAppPath,
    appFound: appFound(),
    profiles: state.profiles.map((p) => ({ ...p, running: keys.has(dirKey(p.dir)) })),
  };
});

ipcMain.handle('icon:get', () => claudeIcon());

ipcMain.handle('profile:save', async (_e, input) => {
  const existing = input.id ? findProfile(input.id) : null;
  const { value, error } = validateProfile(input, existing ? existing.id : null);
  if (error) return { ok: false, error };
  if (existing) Object.assign(existing, value);
  else state.profiles.push({ id: crypto.randomUUID(), ...value });
  await saveState();
  return { ok: true };
});

ipcMain.handle('profile:remove', async (_e, id, trashData) => {
  const p = findProfile(id);
  if (!p) return { ok: true };
  if (trashData && p.dir) {
    const running = (await scanInstances()).some((i) => i.key === dirKey(p.dir));
    if (running) return { ok: false, error: `Quit ${p.name} before deleting its data folder.` };
    if (fs.existsSync(p.dir)) {
      try {
        await shell.trashItem(p.dir);
      } catch (e) {
        return { ok: false, error: `Couldn’t move the folder to the Trash: ${e.message}` };
      }
    }
  }
  state.profiles = state.profiles.filter((x) => x.id !== id);
  await saveState();
  return { ok: true };
});

ipcMain.handle('profile:launch', async (_e, id) => {
  const p = findProfile(id);
  if (!p) return { ok: false, error: 'Profile not found.' };
  if (!appFound()) {
    return { ok: false, error: `Claude isn’t at ${state.claudeAppPath}. Choose its location first.` };
  }
  // -n always starts a fresh process. If this profile is already running, Chromium's
  // single-instance lock (keyed on the data folder) hands off to it and exits.
  const args = ['-n', '-a', state.claudeAppPath];
  if (p.dir) args.push('--args', `--user-data-dir=${p.dir}`);
  try {
    await run('/usr/bin/open', args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || 'Could not open Claude.').trim() };
  }
});

ipcMain.handle('signin:others', (_e, id) => othersRunning(id));
ipcMain.handle('signin:quit-others', (_e, id, force) => quitOthers(id, !!force));

ipcMain.handle('app:choose', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose Claude.app',
    defaultPath: '/Applications',
    properties: ['openFile'],
    filters: [{ name: 'Application', extensions: ['app'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false };
  const chosen = res.filePaths[0];
  if (!chosen.endsWith('.app') || !fs.existsSync(path.join(chosen, 'Contents', 'MacOS'))) {
    return { ok: false, error: 'That doesn’t look like an application.' };
  }
  state.claudeAppPath = chosen;
  iconCache = { path: null, url: null };
  await saveState();
  return { ok: true };
});

ipcMain.handle('dir:choose', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a data folder',
    defaultPath: fs.existsSync(INSTANCES_ROOT) ? INSTANCES_ROOT : os.homedir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dir:suggest', (_e, name) => {
  const base = path.join(INSTANCES_ROOT, slugify(name));
  const taken = new Set(state.profiles.filter((p) => p.dir).map((p) => dirKey(p.dir)));
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
});

// ---------------------------------------------------------------- window

function createWindow() {
  const win = new BrowserWindow({
    width: 780,
    height: 580,
    minWidth: 560,
    minHeight: 460,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#17181C' : '#EEF0F3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    await loadState();
    // Packaged builds get the icon from the .icns; `npm start` would otherwise show Electron's.
    if (!app.isPackaged) app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'));
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => app.quit());
}
