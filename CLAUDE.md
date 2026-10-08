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

## Workflow

- **Issues:** track work in GitHub issues (`gh issue create`). When a bug, feature idea, or maintenance task comes up and isn't being done right now, file it with the `bug`, `enhancement`, or `maintenance` label instead of leaving it in chat. Reference issues in commits (`Fixes #12`). The repo is public: never put account IDs, emails, tokens, or personal paths in issues.
- **Commits use [Conventional Commits](https://www.conventionalcommits.org):** `feat:` (minor bump while < 1.0), `fix:` (patch), `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `chore:`; `feat!:` or a `BREAKING CHANGE:` footer for breaking changes. Commits are SSH-signed.
- **Releases are automatic:** release-please (`.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`) keeps a release PR open that bumps `package.json` and writes `CHANGELOG.md`. Merging it tags `vX.Y.Z`, creates the GitHub release, and a macOS job attaches `MultiClaude-vX.Y.Z-macos-arm64.zip`. Never bump the version or edit `CHANGELOG.md` by hand. `.github/workflows/tests.yml` runs `npm test` on pushes and PRs.

## Architecture

Three layers, joined by a single IPC surface:

- **`main.js`** (main process) owns all state and every system call. Profiles live in memory and persist to `~/Library/Application Support/MultiClaude/profiles.json` (`app.getPath('userData')`). On first run it seeds a `default` profile ("Personal Claude") with `dir: null`, which means "launch with no `--user-data-dir`", so Claude's own default folder and current sign-in are reused. At most one profile can have `dir: null`. New profiles saved with a blank folder get one automatically from `autoDir()` → `uniqueProfileDir()` under `~/Library/Application Support/MultiClaude/Profiles/<slug>`, skipping folders already in use or left on disk; editing keeps the existing folder, so renaming never moves data. The folder is created on launch. `validateProfile` also rejects home, the disk root, Claude's default data folder, `~/.claude`, and duplicate folders/names.
- **`preload.js`** exposes `window.multiclaude` through `contextBridge`. Each method maps 1:1 to an `ipcMain.handle` channel in `main.js` (`state:get`, `profile:save`, `profile:launch`, `signin:quit-others`, …). To add a capability, add it in both places. The renderer is sandboxed (`contextIsolation`, `sandbox`, no node integration; navigation and new windows are blocked).
- **`renderer/app.js`** is the UI: profile grid, ⋯ menu, edit/remove dialogs, and the "Sign in or connect…" wizard. It polls `getState()` every 2.5s while visible. A full `render()` happens only when the profile structure changes (the comparison key excludes `running`); otherwise `patchStatus()` updates only the status lines. Status comes from `statusOf()`: the main process only reports `running`, and the renderer layers its own transient states on top (`Starting…` after a launch, then `Didn’t start` after 20s; `Couldn’t open` on launch failure; `Claude not found` when the app is missing). Status dots use fixed `--status-*` system colors (green/yellow/red/grey), never the profile color. Launch through `launchWithStatus()` so tiles show these states. DOM goes through the `el()` helper, which always inserts text as text nodes, never as HTML.
- **`lib/`** holds the logic with tests: `instances.js`, `accounts.js`, and `sharing.js` (the last tested against temp folders). `instances.js` has `parseInstances` (parses `ps -axww -o pid=,command=` output), `dirKey`, `normalizeDir`, `slugify`, `uniqueProfileDir`.

### Instance identity and process matching

A running instance is identified by its **`dirKey`**: the normalized `--user-data-dir` path, or the `DEFAULT_KEY` sentinel `'default'` when the flag is absent. Profiles map to processes by comparing `dirKey(profile.dir)` against keys parsed from `ps`. `parseInstances` keeps only processes whose command is exactly `<app>/Contents/MacOS/Claude`, skips Chromium helpers (`--type=`), and reads the flag value up to the next ` --flag` because paths can contain spaces. If the "Running" status or quit-others misbehaves, look here first. The README notes this was tested against stand-ins, not a live Claude Desktop.

### Accounts

Profiles are tied to Claude accounts by `lastKnownAccountUuid` in each data folder's `config.json` (the only account info Claude keeps in plain text; the token and cookies are Keychain-encrypted, and MultiClaude must not touch them). `lib/accounts.js` holds the tested logic: the first account seen in a profile is remembered as `profile.accountId` (`bindNewAccounts`, skipped if another profile has the same account), and `accountStates` reports each profile as `none`/`ok`/`mismatch` plus `sharedWith`. Emails are user-entered labels in `state.accounts[accountId]`, asked once per account. `profile:launch` refuses to open an account that's already running in another profile (duplicate scheduled tasks, shared session files). Changing a profile's folder forgets its `accountId`. The wizard's `switchAccount` mode walks through logging out and back in.

### Shared session history

`lib/sharing.js` (tested against temp folders) links a profile's per-account session folders (`claude-code-sessions/<id>`, `local-agent-mode-sessions/<id>`, `space-memory-copy/<id>`, `spaces-present/<id[0:8]>`) into Claude's default data folder, so history matches a normal install. It links only the account's own subfolder, never the parent (e.g. `local-agent-mode-sessions/skills-plugin/<org>` is org-keyed and shared across accounts). `shareSessionHistory()` in `main.js` runs it inside `profile:launch` only when the profile isn't running, its account state is `ok`, and no other profile shares the account. First links merge: profile-only files move to the hub, conflicts keep the hub's copy, leftovers go to `MultiClaude/Backups/`; nothing is deleted. If the hub has scheduled tasks for the account, the launch returns `{ confirm }` and the renderer asks before retrying with `confirmSharing`. Root-level settings files (`claude_desktop_config.json` etc.) can't be shared by links: Claude saves them via temp file + rename, which replaces a symlink (tested). They stay per profile.

### Launch and sign-in flow

- Launch runs `open -n -a <Claude.app> --args --user-data-dir=<dir>`. `-n` always starts a new process; when that profile is already running, Chromium's single-instance lock (keyed on the data folder) hands off to the existing instance, so no duplicate appears.
- The sign-in wizard exists because macOS routes `claude://` OAuth callbacks to only one app. It quits all other instances (SIGTERM, polling `ps` until they exit, with force quit/SIGKILL offered only if they don't), opens the target profile alone, then offers to reopen the ones it closed (`quitIds`).
- Claude's icon is read from the installed app's `Info.plist` at runtime and cached per app path. Nothing from Claude is bundled.

## Known limits (from README)

- Claude Code is not isolated per profile. Code sessions started from Desktop still read `~/.claude`, because no per-profile `CLAUDE_CONFIG_DIR` is set.
- All instances share the same Dock icon and name.
