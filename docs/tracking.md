# Work Tracking

Track active work in GitHub issues. The open backlog below holds known
follow-ups that are not yet scheduled; move an item into an issue when it is
picked up and delete it here once it lands. Former tracker keys are kept in
parentheses as history.

## What Belongs In Repo Docs

- stable system facts
- harnesses and verification commands
- architecture decisions
- operator and package usage
- the short backlog below

## Backlog

### Add a backup restore command (AUR-676)

Backups are automated (deterministic JSONL in a git repo, run by the backup
step of the scheduled pipeline), but restore is manual; see Known Limits in
[architecture.md](./architecture.md).

Acceptance:

- `reddit-cached backup restore <repo-or-path>` rebuilds a database from the
  JSONL tables. The FTS index is rebuilt, not restored.
- It refuses to overwrite an existing non-empty database unless an explicit
  flag is passed.
- A round-trip test runs backup, restore, and backup again, and asserts the
  second backup is byte-identical (the deterministic export makes this
  assertable).
- Docs are updated: [interfaces/cli.md](./interfaces/cli.md), Known Limits in
  [architecture.md](./architecture.md), and `skills/reddit-cached/SKILL.md` if
  the command surface changes.

### Other follow-ups

- Load-test sustained sync and SSE backpressure (AUR-675): a repeatable harness
  for a long sync (thousands of items or a throttled fake API) checking
  checkpoint integrity and memory, plus SSE progress with a slow consumer;
  then update the weak-spot list in [harness/web.md](./harness/web.md).
- Sign and notarize macOS release binaries (AUR-677): port tprompt's
  sign, notarize, and verify release steps so browser-downloaded darwin
  binaries pass Gatekeeper, and document the secret names in
  [releasing.md](./releasing.md).
- Windows support, deferred (AUR-678): would need a windows-x64 release
  target, a Scheduled Task analog to `jobs install-launchd` /
  `install-systemd`, and a real Windows test host before claiming support.
