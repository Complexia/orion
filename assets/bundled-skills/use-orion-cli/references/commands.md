# Orion CLI command reference

## Authentication and discovery

```sh
orion-cli login
orion-cli whoami --json
orion-cli list --json
orion-cli status --json
orion-cli open
```

`ORION_ORIGIN` selects the Orion Web origin. `ORION_TOKEN` overrides saved
credentials for CI and agent runs. `ORION_CONFIG_DIR` selects the local
credential directory.

## Repositories and collaborators

```sh
orion-cli repo list --json
orion-cli repo create <name> --default-branch main --json
orion-cli repo configure <name-or-id> --visibility private --description <text> --json
orion-cli collaborator list --project <name-or-id> --json
orion-cli collaborator add <handle> --project <name-or-id> --role write --json
orion-cli collaborator role <handle> --project <name-or-id> --role admin --json
orion-cli collaborator remove <handle> --project <name-or-id> --yes --json
orion-cli repo delete <name-or-id> --yes --json
```

## Source control and GitHub mirroring

```sh
orion-cli source status --json
orion-cli source use-orion --json
orion-cli source mirror status --json
orion-cli source mirror authorize
orion-cli source mirror disconnect --json
```

## Pull requests

```sh
orion-cli pr list --state open --json
orion-cli pr view <number> --json
orion-cli pr create --title <title> --body <body> --base <branch> --head <branch> --json
orion-cli pr checkout <number>
orion-cli pr update-branch <number>
orion-cli pr push <number> --json
orion-cli pr merge <number> --merge --json
orion-cli pr close <number> --json
orion-cli pr reopen <number> --json
```

`pr update-branch` may leave a conflicted merge in progress. Resolve it, test,
commit, and use `pr push` before rechecking mergeability.

## Deployments and configuration

```sh
orion-cli deploy --json
orion-cli deploy --project <id> --no-push --json
orion-cli configure --root <dir> --build-command <cmd> --start-command <cmd> --healthcheck /healthz --json
orion-cli activity --json
orion-cli logs <deployment-id> --stream build --json
```

## Environments, previews, and vaults

```sh
orion-cli environment list --json
orion-cli environment create <name> --slug <slug> --json
orion-cli preview configure --enable --pull-request-previews --ttl 72 --json
orion-cli env list --environment production --json
orion-cli env push <file> --environment production --json
printf '%s' "$VALUE" | orion-cli env set NAME --stdin --environment production --json
orion-cli env reveal NAME --environment production
```

Keep secret values out of argv and output. Preview environments should
normally be limited to open pull requests.

## Services, domains, and storage

```sh
orion-cli service list --json
orion-cli service create <name> --root <dir> --inherit DATABASE_URL --json
orion-cli service configure <name> --no-deploy-on-push --json
orion-cli service deploy <name> --json
orion-cli domain list --json
orion-cli domain add <hostname> --json
orion-cli domain primary <hostname> --json
orion-cli domain add <hostname> --service <name> --json
orion-cli bucket list --json
orion-cli bucket create <name> --json
orion-cli resources list --json
orion-cli resources sync <resources.json> --json
```

## Plans

```sh
orion-cli plan upload <plan.html> --json
```

The plan must be non-empty HTML no larger than 5 MB. The result contains the
opaque plan `id` and unlisted public `url`. Upload only for an explicit user
request for a plan, and always return the URL to that user.
