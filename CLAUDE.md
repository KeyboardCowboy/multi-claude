# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small macOS-only Electron app that launches isolated Claude Desktop instances, one per account, by passing `--user-data-dir=<folder>` to `/Applications/Claude.app`. This is an unsupported community technique; Claude Desktop updates may change how it behaves. No build step, no framework, no runtime dependencies: plain CommonJS in main and vanilla JS/DOM in the renderer.

## Commands

```bash
npm install
npm start                 # run in dev (electron .)
npm test                  # node --test, runs test/*.test.js
node --test --test-name-pattern="spaces" test/instances.test.js   # single test
npm run package           # builds dist/MultiClaude-darwin-arm64/MultiClaude.app
npm run icon              # regenerates build/icon.icns + build/icon.png from build/icon.svg (needs rsvg-convert)
```

`package` is hardcoded to `--arch=arm64`; change it to `x64` for Intel. No linter or formatter is configured. The app icon's source of truth is `build/icon.svg` (original artwork, three overlapping tiles: Berry and Teal swatches behind Claude orange #D97757; a brand color is fine, but never use Claude/Anthropic logos or marks). After editing it, run `npm run icon` and commit the generated `.icns`/`.png`. `npm start` sets the Dock icon from `build/icon.png`; packaged builds use the `.icns`.

## Architecture

Three layers, joined by a single IPC surface:

- **`main.js`** (main process) owns all state and every system call. Profiles live in memory and persist to `~/Library/Application Support/MultiClaude/profiles.json` (`app.getPath('userData')`). On first run it seeds a `default` profile ("Personal Claude") with `dir: null`, which means "launch with no `--user-data-dir`", so Claude's own default folder and current sign-in are reused. At most one profile can have `dir: null`. `validateProfile` also rejects home, the disk root, Claude's default data folder, `~/.claude`, and duplicate folders/names.
- **`preload.js`** exposes `window.multiclaude` through `contextBridge`. Each method maps 1:1 to an `ipcMain.handle` channel in `main.js` (`state:get`, `profile:save`, `profile:launch`, `signin:quit-others`, …). To add a capability, add it in both places. The renderer is sandboxed (`contextIsolation`, `sandbox`, no node integration; navigation and new windows are blocked).
- **`renderer/app.js`** is the UI: profile grid, ⋯ menu, edit/remove dialogs, and the "Sign in or connect…" wizard. It polls `getState()` every 2.5s while visible. A full `render()` happens only when the profile structure changes (the comparison key excludes `running`); otherwise `patchStatus()` updates only the running dots. DOM goes through the `el()` helper, which always inserts text as text nodes, never as HTML.
- **`lib/instances.js`** holds the pure, testable logic and is the only part with tests: `parseInstances` (parses `ps -axww -o pid=,command=` output), `dirKey`, `normalizeDir`, `slugify`.

### Instance identity and process matching

A running instance is identified by its **`dirKey`**: the normalized `--user-data-dir` path, or the `DEFAULT_KEY` sentinel `'default'` when the flag is absent. Profiles map to processes by comparing `dirKey(profile.dir)` against keys parsed from `ps`. `parseInstances` keeps only processes whose command is exactly `<app>/Contents/MacOS/Claude`, skips Chromium helpers (`--type=`), and reads the flag value up to the next ` --flag` because paths can contain spaces. If the "Running" status or quit-others misbehaves, look here first. The README notes this was tested against stand-ins, not a live Claude Desktop.

### Launch and sign-in flow

- Launch runs `open -n -a <Claude.app> --args --user-data-dir=<dir>`. `-n` always starts a new process; when that profile is already running, Chromium's single-instance lock (keyed on the data folder) hands off to the existing instance, so no duplicate appears.
- The sign-in wizard exists because macOS routes `claude://` OAuth callbacks to only one app. It quits all other instances (SIGTERM, polling `ps` until they exit, with force quit/SIGKILL offered only if they don't), opens the target profile alone, then offers to reopen the ones it closed (`quitIds`).
- Claude's icon is read from the installed app's `Info.plist` at runtime and cached per app path. Nothing from Claude is bundled.

## Known limits (from README)

- Claude Code is not isolated per profile. Code sessions started from Desktop still read `~/.claude`, because no per-profile `CLAUDE_CONFIG_DIR` is set.
- All instances share the same Dock icon and name.
