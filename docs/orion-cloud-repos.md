# Orion Cloud repositories

Orion Desktop can publish any local git repository to Orion Cloud (Orion Web)
and keep it in sync — a lightweight GitHub alternative for code storage and
source control, built around real git data.

## Using it

Sign in to your Orion account (Settings → Account), open a project that is a
git repository, then use the controls next to **Commit and Push** in the shell
bar:

- **Publish** — creates the cloud repository (named after the project folder)
  and pushes all branches. The link is stored in the repo's local git config
  (`orion.cloudrepoid`), so it survives restarts and is per-repository.
- **Push** (cloud-upload icon) — uploads new commits from all local branches.
  Highlighted when local commits haven't been pushed. Pushes are
  fast-forward-only; if the cloud copy has changes you don't have, pull first.
- **Pull** (cloud-download icon) — downloads new commits (including edits made
  in the web editor), updates `refs/remotes/orion/*`, and fast-forwards the
  current branch when possible. On divergence it fetches and asks you to merge
  `refs/remotes/orion/<branch>` manually.
- **Globe** — opens the repository on Orion Web, where you can browse the file
  tree, edit files in Monaco, create and delete files. Every web edit is a real
  git commit (authored with your account identity) that the next pull brings
  down.

## How it works

The server (Vercel) has no git binary, so this module does the plumbing with
the system git; see `src/cloud-sync.js`:

- **Push**: `git pack-objects --revs` builds one incremental packfile covering
  everything the server's refs don't reach. The pack, a per-branch file
  manifest (`git ls-tree`), and any raw file blobs the server is missing are
  uploaded directly to object storage via presigned URLs. Ref updates are
  committed atomically with a compare-and-swap; concurrent pushes or web edits
  can't clobber each other.
- **Pull**: packfiles and loose objects (web edits) are downloaded straight
  into `.git/objects` — both are inert, content-addressed formats git reads
  natively — then `refs/remotes/orion/*` is updated and the current branch is
  fast-forwarded (`git merge --ff-only`). Nothing is rewritten; a pull can at
  worst add unreferenced objects.
- Auth uses the existing Orion account desktop session (bearer token) against
  `/api/git/*` on Orion Web.
- **Compaction**: every push adds one incremental pack and every web edit adds
  loose objects, so a background worker (`orion-web/git-worker`, Rust, hosted
  on Railway) periodically consolidates each repo into a single optimized pack
  with `git repack` and swaps it in atomically. Clients notice nothing — the
  next pull just downloads one pack instead of many. See its README for the
  full design (thresholds, tombstone GC, concurrency safety).
- **Hosted apps (opt-in deploy)**: pressing **Deploy** on a repo's Orion Cloud
  page provisions a hosted app at `https://<name>-<id>.andromedus.dev`. From
  then on every push to the default branch redeploys it automatically. The git
  worker deploys the default branch to Railway (Railpack auto-builds
  Next.js/Node/etc.), and `orion-web/gateway` — which holds the
  `*.andromedus.dev` wildcard domain — routes each subdomain to its app. The
  repo page shows live deploy status and links to the app.

## Local development

Run Orion Web locally (see its README: docker Postgres + MinIO, then
`bun run dev`) and start the desktop app with:

```bash
ORION_WEB_URL=http://localhost:3000 npm run start
```
