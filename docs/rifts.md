# Rifts (experimental)

Rifts gives each epic an isolated copy-on-write clone of its repository, powered
by [rift](https://github.com/anomalyco/rift) (APFS `clonefile` on macOS, btrfs
snapshots / native reflinks on Linux). Creating a rift is near-instant and costs
almost no disk space.

## Using it

1. Enable **Settings → Experimental → Rifts**.
2. Create an epic. With **Create a rift per epic** on (the default), the create
   dialog pre-checks "Work in a rift"; uncheck it to opt out for that epic.
3. Orion registers the project with rift (`rift init`, idempotent), creates a
   rift from a clean `HEAD` snapshot, and checks out a fresh branch inside the
   rift — the readable part is chosen by the epic message model (fallback:
   `epic/<slug>`) and Orion adds a globally unique suffix. Rift creation is
   refused while the source has staged, unstaged, or untracked changes.
4. Every thread grouped under the epic runs its agent processes inside the rift,
   and so do the repository controls for those threads: git state and the
   branch picker, Commit & push, Orion Cloud, the Code tab and Open With all
   point at the rift, not the source project. The epic's **Commit & push** /
   **Create PR** actions operate there too, and stage everything (`git add -A`)
   — inside a rift the workspace only ever contains that epic's work. If the
   Orion project is a monorepo subdirectory, threads and project-scoped tools
   keep that same relative directory inside the rift.
5. Turns are blocked while a rift is still being created, so an epic's first
   turn never starts in the source repository and then has to move.
6. Deleting the epic moves its rift into rift-owned trash (recoverable until
   `rift gc`); nothing is deleted physically. Its threads survive, so they are
   reset to a fresh agent session — the sessions recorded against the removed
   workspace cannot be resumed. Removing one thread from a rift-backed epic
   likewise stops its live agent/terminal runtime and starts fresh in the source
   project. The delete prompt says so.

Rift storage lives beside the source repository:
`<parent>/.rifts/<repo-name>/<epic-slug>-<suffix>/`.

Rifts always use exact copies including `node_modules` and other ignored build
artifacts. This is the instant copy-on-write path, lets agents build/test
immediately, and avoids the broken filtered-copy mode in the bundled
`rift-snapshot@0.0.10` binary.

Without rifts enabled, epic git actions run in the claimed repository and
`git add -A` stages all local changes there — accepted trade-off. Such an epic
is still locked to the repository and branch it first committed on, and to a
branch no other epic has claimed: `validateEpicGitTarget` (src/main.js) refuses
the action if the checkout has since drifted. A rift-backed epic owns its whole
workspace, so only the "not the default branch" part of that check applies to
it.

## Implementation

- `rift-snapshot` is pinned to an **exact version** in package.json; its
  prebuilt CLI (`node_modules/rift-snapshot/prebuilds/<platform>-<arch>/rift`)
  is spawned by the main process (`src/main/rift.js`). The Bun/Node FFI
  bindings need runtimes Electron doesn't provide.
- IPC: `rift:status`, `epic:createRift`, `epic:removeRift` (src/main.js).
- Packaging mirrors node-pty: copied in `packageAfterCopy`, asar-unpacked, and
  the binary exec bit is restored there and in `postinstall`.

## Updating rift

Updates are manual only (the exact pin prevents surprise upgrades):

```bash
bun run update-rifts
```

This checks npm for the latest `rift-snapshot`, updates the pin, runs
`bun install`, refreshes `package-lock.json`, and smoke-tests the platform
binary. Review the
[release notes](https://github.com/anomalyco/rift/releases) and commit
package.json + bun.lock + package-lock.json.
