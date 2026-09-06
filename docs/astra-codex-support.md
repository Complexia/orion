# Astra support in Orion

Verified on September 6, 2026 against the [Astra release](https://openai.com/index/gpt-6-astra/), [model guidance](https://developers.openai.com/api/docs/guides/latest-model), and the installed Codex 0.153.4 app-server schema.

## Context retention

Orion enables `features.context_management.experimental_mode` for `gpt-6-astra` on fresh and resumed app-server threads and one-shot Codex execution. This lets Codex manage notes and searchable earlier context windows. It does not enable cross-chat memories or change the user's global configuration.

Settings → Providers → Codex → Long-session context offers:

- Automatic: enable for Astra; leave other models at their Codex defaults.
- Enabled in Orion / Disabled in Orion: explicit overrides.
- Use Codex configuration: do not override the host setting, including custom CLI flags.

The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) marks this experimental and requires eligible ChatGPT sign-in (Plus, Pro, or Pro Lite). The local 0.150.1 CLI rejected the nested feature configuration; 0.153.4 accepts it. Upgrade older Codex installations before using this setting. A running app-server must be restarted to use an updated CLI.

Normal compaction remains owned by Codex. When Orion enables notes/searchable history, it does not run its legacy rollback/compact/retry recovery sequence over that history.

## Capability audit

| Capability | Orion behavior |
| --- | --- |
| Model selection | Astra is first in the Codex picker. |
| Reasoning | Low, Medium, High, Extra High, Max, and Ultra; Medium default, verified against live `model/list`. |
| Fast mode | Standard and Fast use Codex's service tier; the runtime advertises `priority` for Astra. Model, effort, and tier remain explicit at dispatch. |
| Images | Supported PNG/JPEG/WebP/GIF attachments reach native `localImage` inputs on new turns and steering. Astra receives original image detail. Other files remain local references. |
| Mid-turn steering | Uses native `turn/steer` with the active turn ID, including image attachments. Completed-turn races remain rejected. |
| Asynchronous messages | Message completion does not end the run. Separate question titles/options accompanying asynchronous messages are retained in the transcript. |
| Clarification requests | Native `item/tool/requestUserInput` has a local reply panel with suggested choices and free text. Requests survive navigating away and back while the run remains active. Stop and server resolution clear pending requests; stale answers are rejected. |
| Native subagents | Codex owns execution and concurrency. Orion retains its descendant watcher and recognizes both collaboration and newer subagent activity events. Ultra reaches Codex unchanged. |
| Tools and waiting | Codex executes tools, including its code-mode/async machinery. Orion exposes native function outputs, image-view and interruptible-wait activity and answers the current-time callback. |
| Context/output limits | Orion sets no context-window, output-token, or auto-compaction token cap. Runtime limits remain authoritative; the public Responses API window is not substituted for the Codex model catalog. |
| Safety and availability | Native warnings, config notices, and guardian notices reach the activity feed. Provider policy errors do not enter context recovery. |

## Host and account dependencies

Model intelligence does not provision desktop integrations. The [official Computer Use setup](https://learn.chatgpt.com/docs/computer-use) depends on the ChatGPT desktop plugin, OS permissions, and approved apps. Orion retains its existing verified Chrome integration/MCP fallback. This change does not recreate the private ChatGPT host bridge or grant new app access.

Likewise, Astra Pro, API-only request parameters, account eligibility, plugin authentication, and provider restrictions are not unlocked by a model-picker entry. Orion's Codex provider uses app-server rather than constructing Responses API requests itself.

## Validation

- Configuration, driver, steering, model-catalog, shared-server, and remote-control regression checks.
- Mocked protocol tests cover image inputs, effort/tier forwarding, async question delivery, clarification replies, cancellation, request ownership, notices, and native context ownership.
- The actual 0.153.4 app-server accepted an ephemeral Astra thread with experimental context, Max, and Fast. No model request was needed for this configuration check.
- The actual reply component was checked visually and exercised in a browser with a mock bridge: selection plus free text submitted successfully and removed the pending question.
- Production app packaging passed. No long session was driven through a real context-window rollover, and no claim is made that every desktop integration was exercised.
