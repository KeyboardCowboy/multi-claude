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

## Download

Each release on the [Releases page](https://github.com/KeyboardCowboy/multi-claude/releases) has a zipped `MultiClaude.app` for Apple Silicon. It isn't signed by Apple, so the first time you open it, right-click it and choose **Open**.

## Build a double-clickable app

```
npm run package
```

This creates `dist/MultiClaude-darwin-arm64/MultiClaude.app` for Apple Silicon. On an Intel Mac, change `--arch=arm64` to `--arch=x64` in `package.json`. Drag the result into Applications. Because it's built on your own machine, Gatekeeper normally won't complain; if it does, right-click and choose Open once.

The app icon is drawn in `build/icon.svg`. After changing it, run `npm run icon` (needs `brew install librsvg`) to regenerate `build/icon.icns`, then package again.

## Using it

- **Click a profile** to open that Claude instance. If it's already running, you're taken to it instead of getting a duplicate.
- **Green dot and "Running"** show which profiles are open. The list refreshes every few seconds.
- **Add profile** (the + tile) asks for a name and a color. MultiClaude creates the profile's data folder for you in `~/Library/Application Support/MultiClaude/Profiles/`. To pick a folder yourself, open **Data folder** in the same dialog.
- **Personal Claude** is created for you using Claude's default folder, so whatever account you're signed into now stays signed in. Only one profile can use the default folder.
- **Account email** under each profile shows which Claude account is signed into it. Claude stores only an account ID on your Mac, so the first time MultiClaude sees a new account it asks for the email once (**Add account email**). After that, the ID keeps the label accurate.
- **Account warnings**: if a profile ends up signed into a different account than usual (for example, someone logged out and into another account inside Claude), its account line turns red. Click it to switch back, keep the new account, or remove a duplicate profile. MultiClaude won't open the same account in two profiles at once, since both would write that account's local sessions and run its scheduled tasks twice.
- **⋯ menu** on each profile: Sign in or connect…, Add/Change account email…, Edit…, Remove…

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
- Settings are stored in `~/Library/Application Support/MultiClaude/profiles.json`, and new profiles' data folders in `~/Library/Application Support/MultiClaude/Profiles/`. Profiles created before this keep their existing folders.

## Why separate folders are needed

Claude Desktop already signs in and out of several accounts, so why not just do that? Because a single install keeps only some things apart by account. Looking inside its data folder (`~/Library/Application Support/Claude`) shows the split. This is observed behavior, not documented by Anthropic, so it can change between versions.

```
~/Library/Application Support/Claude/
│
│  ── Shared by every account (one copy) ──
├── config.json                  sign-in token (encrypted), last signed-in account, app prefs
├── Cookies                      claude.ai login cookie, one account's at a time
├── Local Storage/, IndexedDB/   claude.ai web app's local cache
├── claude_desktop_config.json   local MCP servers
├── Claude Extensions/           installed desktop extensions
├── window-state.json, Preferences, caches…
│
│  ── Filed by account, then organization ──
├── claude-code-sessions/<account-id>/<org-id>/        Claude Code sessions, scheduled tasks
├── local-agent-mode-sessions/<account-id>/<org-id>/   Cowork sessions
├── space-memory-copy/<account-id>/<org-id>/
├── spaces-present/<account-id>/<org-id>/
└── Partitions/cowork-artifact-<account-id>-<org-id>/  storage for artifact views
```

What that means when you sign out of one account and into another in a single install:

- **Kept apart:** local Claude Code and Cowork sessions, their memory, and artifact storage. They reappear when you sign back in.
- **Swapped:** the sign-in itself. There is one token and one cookie jar, so only one account can be signed in at a time.
- **Shared:** local MCP servers, installed extensions, window state, and preferences. Every account sees the same set.
- **Not here at all:** chats and projects live on Anthropic's servers, per account. Claude Code's `~/.claude` folder is shared by all accounts.

MultiClaude gives each profile its own copy of this folder, so each one has its own sign-in, MCP servers, and extensions, and they can all run at the same time. `~/.claude` is still shared by all of them (see below).

### Session history is shared with Claude's usual folder

The per-account parts (the four folders filed by `<account-id>` above) are not copied. Each time a profile opens, MultiClaude links its account's folders into Claude's usual folder, so an account's local Claude Code and Cowork sessions, scheduled tasks, and memory live in one place whether you open it through MultiClaude or sign into it in Claude Desktop the normal way. If you stop using MultiClaude, nothing is lost.

- Only the profile's own account folder is linked. Folders filed by organization (like `local-agent-mode-sessions/skills-plugin`) stay in the profile, since other accounts in the same organization share them.
- The first time a profile is linked, anything it had that Claude's usual folder lacks is moved there. If both have the same file, the usual folder's copy is kept and the profile's is moved to `~/Library/Application Support/MultiClaude/Backups/`. Nothing is deleted.
- If the account already has scheduled tasks in Claude's usual folder, MultiClaude asks before the first link, because those tasks will start running in that profile.
- Linking happens only while neither the profile nor another instance signed into the same account is running, and MultiClaude never opens one account twice, so two instances never write the same account's history.
- If Claude ever replaces a link with a plain folder, the next launch merges it back.

## Known limits

- Running instances all show the same Claude icon and name in the Dock. The colors and names exist only in MultiClaude.
- Claude Code is not isolated per profile. Desktop-spawned Code sessions still read `~/.claude`, so settings and memory can blend across profiles. Isolating that needs a per-profile `CLAUDE_CONFIG_DIR`, which this app doesn't set.
- Quitting an instance closes it immediately, so unsent text in its windows may be lost.
- Written and tested away from a Mac: the launching logic, process matching, and UI were tested with stand-ins for Electron and the browser, not against a live Claude Desktop. If the "Running" dot or the quit step misbehaves on your machine, the first suspect is the `ps` matching in `lib/instances.js`.

## Tests

```
npm test
```

Covers the process-list parsing (including folders with spaces and Chromium helper processes), account detection, and session-history linking (run against temporary folders). They also run on GitHub for every push and pull request.

## Contributing

Bugs, ideas, and maintenance tasks are tracked in [GitHub issues](https://github.com/KeyboardCowboy/multi-claude/issues). Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, …): releases, version numbers, and the changelog are generated from them automatically.
