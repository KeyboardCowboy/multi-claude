# MultiClaude

A small Electron app for macOS that launches separate, isolated Claude Desktop instances, one per account, from a grid of named icons ("Personal Claude", "Work Claude", …).

It relies on Electron's `--user-data-dir` flag, so each profile keeps its own sign-in, settings, and connectors in its own folder. This is a community technique, not something Anthropic supports, so an app update could change how it behaves.

## Run it

```
cd multiclaude
npm install
npm start
```

Needs Node 18+ and Claude Desktop at `/Applications/Claude.app` (use **Change…** in the footer if it lives elsewhere).

## Build a double-clickable app

```
npm run package
```

This creates `dist/MultiClaude-darwin-arm64/MultiClaude.app` for Apple Silicon. On an Intel Mac, change `--arch=arm64` to `--arch=x64` in `package.json`. Drag the result into Applications. Because it's built on your own machine, Gatekeeper normally won't complain; if it does, right-click and choose Open once.

The app icon is drawn in `build/icon.svg`. After changing it, run `npm run icon` (needs `brew install librsvg`) to regenerate `build/icon.icns`, then package again.

## Using it

- **Click a profile** to open that Claude instance. If it's already running, you're taken to it instead of getting a duplicate.
- **Green dot and "Running"** show which profiles are open. The list refreshes every few seconds.
- **Add profile** (the + tile) asks for a name, a color, and a data folder. The folder is suggested for you under `~/.claude-instances/`.
- **Personal Claude** is created for you using Claude's default folder, so whatever account you're signed into now stays signed in. Only one profile can use the default folder.
- **⋯ menu** on each profile: Sign in or connect…, Edit…, Remove…

### Sign in or connect…

Sign-in and connector (MCP) authorizations finish in your browser and return to the app through a `claude://` link. macOS gives that link to a single app, so with several instances running it can land in the wrong one. This guided flow avoids that:

1. Closes your other Claude instances (after you click **Quit them**).
2. Reminds you to check which Claude account your browser is signed into.
3. Opens only the profile you chose.
4. Walks you through finishing in the app, then offers to reopen what it closed.

You only need it for the first sign-in on each profile and when you add connectors. Day to day, just click the profiles.

## How it works

- Launch: `open -n -a /Applications/Claude.app --args --user-data-dir=<folder>` (no flag for the default profile).
- Running status: reads `ps` and matches each Claude main process by its `--user-data-dir`.
- Quitting others: sends a normal quit signal (SIGTERM) to those processes, and only offers a force quit if they don't exit.
- Icon: read from your installed Claude.app at runtime. Nothing from Claude is bundled in this app.
- Settings are stored in `~/Library/Application Support/MultiClaude/profiles.json`.

## Known limits

- Running instances all show the same Claude icon and name in the Dock. The colors and names exist only in MultiClaude.
- Claude Code is not isolated per profile. Desktop-spawned Code sessions still read `~/.claude`, so settings and memory can blend across profiles. Isolating that needs a per-profile `CLAUDE_CONFIG_DIR`, which this app doesn't set.
- Quitting an instance closes it immediately, so unsent text in its windows may be lost.
- Written and tested away from a Mac: the launching logic, process matching, and UI were tested with stand-ins for Electron and the browser, not against a live Claude Desktop. If the "Running" dot or the quit step misbehaves on your machine, the first suspect is the `ps` matching in `lib/instances.js`.

## Tests

```
npm test
```

Covers the process-list parsing (including folders with spaces and Chromium helper processes).
