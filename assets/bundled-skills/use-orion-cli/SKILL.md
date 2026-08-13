---
name: use-orion-cli
description: Operate Orion source control and Orion Cloud with orion-cli. Use for Orion repositories, pull requests, deployments, services, environments, previews, variables, domains, buckets, logs, GitHub mirroring, or when a user explicitly asks for a plan that should be published and shared as a link.
---

# Orion CLI

Use `orion-cli` from the relevant project directory. Prefer `--json`, parse the
single JSON object on stdout, and treat a nonzero exit as failure. Run
`orion-cli help` or `<command> --help` when the installed command contract is
unclear. Read [references/commands.md](references/commands.md) when using
anything beyond the quick workflows below.

## Guardrails

- Authenticate with `orion-cli login` or `ORION_TOKEN`. Never print, persist in
  a remote URL, or pass a token in a command argument other than the explicit
  `login --token` flow.
- Inspect before changing state with `whoami`, `status`, `list`, `repo list`,
  `resources list`, or `pr view`.
- Resolve exact app, repository, environment, service, and domain targets
  before a mutation. Use `--yes` only for an intended destructive command.
- Deploy through Orion Cloud. Do not substitute direct Railway, Vercel, or
  provider-dashboard deployment unless the user explicitly asks for that.
- Commit app changes before deployment. Orion deploys `HEAD`, not uncommitted
  work. Verify the terminal deploy state and smoke-test the returned URL.

## Publish a requested plan

Publish a plan only when the user explicitly asks for a plan of something. Do
not upload routine internal planning, status notes, or plans created merely to
organize implementation work.

1. Write a self-contained HTML plan with no credentials, secrets, or private
   data. Anyone with the returned link can view it.
2. Run `orion-cli plan upload <plan.html> --json`.
3. Confirm the JSON has `ok: true`, then include its exact `url` in the response
   to the user.
4. If upload fails, report the failure and do not imply that a share link was
   created.

## Deploy and verify

```sh
orion-cli deploy --json
orion-cli status --json
```

Treat deployment as successful only when the deploy response reports
`ok: true` and `status: "deployed"`. Use its `url` for live verification.

## Resolve and merge a pull request

```sh
orion-cli pr view <number> --json
orion-cli pr checkout <number>
orion-cli pr update-branch <number>
# Resolve conflicts, test, and commit if the merge remains in progress.
orion-cli pr push <number> --json
orion-cli pr view <number> --json
orion-cli pr merge <number> --merge --json
```
