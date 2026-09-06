# Claude Fable 5.1 in Orion

Audited September 6, 2026 against Anthropic's [release announcement](https://www.anthropic.com/claude-fable-and-mythos-5-1), [Fable 5.1 integration guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1), [Claude Code model configuration](https://code.claude.com/docs/en/model-config), and the installed Agent SDK 0.3.261 / Claude Code 2.1.261 contracts.

Orion's desktop Claude chat runs the native Claude Code engine through the Agent SDK. This audit covers model inputs, settings, tools, persistent sessions, background work, and the desktop reply surface. It does not claim that every Claude Code terminal command or every Claude Desktop integration has a matching Orion UI.

## Changes

| Area | Before | After |
| --- | --- | --- |
| Runtime | The dependency floor and package lock predated Fable 5.1; any installed CLI shadowed the bundled runtime. | SDK and platform binaries are pinned by the lockfiles to 0.3.261, and the native executable is copied outside the packaged ASAR archive. Persistent sessions prefer an installed CLI only when it is at least 2.1.261; otherwise they use the bundle. |
| Vision and PDFs | Attachments were referenced in prompt text; Claude needed to discover and read the files itself. | The composer now forwards attachment metadata for Claude and Codex as well as Kimi. Image and PDF content blocks accompany ordinary and steered user messages. Original local paths remain available for reading, cropping, and other file tools. Missing supported attachments fail preparation instead of silently disappearing. Resume-start fallback keeps the native content. |
| Questions | No callback/reply surface for native `AskUserQuestion`. | Pending requests stay in the main process across desktop navigation. The composer supports single choice, multiple choices, and custom answers. Answers return through the SDK using the original question text. |
| Permissions | Tools needing a prompt had no host approval handler. | Calls reaching the SDK permission callback show the actual tool input and reason, with explicit Allow once / Deny. Existing Claude permission modes, rules, and hooks still run first. Stop, cancellation, and session disposal deny unanswered requests; stale/replayed replies are rejected. |
| Extended context | The renderer showed 1M for Fable but its model ID was excluded from the backend's `[1m]` selection. | Selecting 1M reaches Claude Code as `claude-fable-5-1[1m]`, including gateway setups. The UI describes configuration/provider overrides rather than promising an unconditional window. |
| Provider notices | The Claude driver discarded native fallback, retry, permission-denial, and usage-limit notices. | These appear in turn activity so users can see a fallback or a provider delay. Orion does not override native routing or bypass provider safeguards. |
| Verification | Direct Electron imports executed a Vite `?raw` shim; affected tests could exit zero before assertions. | The Claude and steering test entry points now bundle raw imports as text and reach their success assertions. |

## Capabilities already inherited

- **Effort and thinking:** low, medium, high, xhigh, and max pass through unchanged; high is the default. Legacy Ultracode/Ultrathink shortcuts remain separate from these five effort levels. Orion does not set a thinking budget or output-token ceiling.
- **Long work and history:** the SDK owns native conversation history, thinking blocks, context management, auto memory, and compaction. Orion appends user messages and resumes native sessions instead of reconstructing API history from rendered chat. It does not impose a model-turn, cost, or active-run timeout. Changes to model/effort/access settings currently replace the process and resume the conversation, so background tasks in that old process do not survive a settings change.
- **Tools and parallel work:** the native tool set remains unrestricted by an Orion `tools` filter. Claude can use its own Task/Workflow/background operations, web search/fetch, shell and file tools. Native agent tracking, completion boundaries, and SDK task-stop behavior remain intact. Orion's separate cross-provider `spawn_subagent` tool is a blocking bridge; use native Task/Workflow for Claude-native asynchronous delegation.
- **Instructions and extensions:** the Claude Code system-prompt preset and user/project/local settings are enabled. Native CLAUDE.md, rules, memory, skills, hooks, configured plugins, and MCP configuration remain owned by Claude Code. Slash-command discovery and expansion remain native. See [SDK feature loading](https://code.claude.com/docs/en/agent-sdk/claude-code-features).
- **Vision tooling:** original image/video files remain available to the native shell/read tools. Crop/zoom and video analysis depend on the image-processing tools available on the host. Orion does not pre-resize native image inputs.
- **Browser control:** the existing Claude in Chrome provider option supplies the native Chrome tools when configured and allowed by the selected access mode. Extension setup, sign-in, and computer permissions remain host requirements.

## Boundaries

Fable 5.1 availability, plan billing, backend limits, and domain-specific model fallback remain Anthropic decisions. Claude Code's configuration and environment can limit extended context; Orion preserves those settings. Fable is not a fast-mode model: [Claude Code fast mode](https://code.claude.com/docs/en/fast-mode) currently targets supported Opus models, so enabling it is not a Fable capability upgrade.

The new question/approval cards are in desktop chat. Remote Orion does not yet have the equivalent interactive card. General MCP elicitation forms/URL authentication and arbitrary native `onUserDialog` kinds are not implemented by this card; flows requiring those surfaces may still require the native Claude Code terminal. Orion does not advertise unsupported dialog kinds. Native model-fallback text is displayed; partial-message retraction metadata is not yet applied to Orion's flattened transcript. The native SDK conversation remains authoritative.

Orion's embedded Claude Code CLI model remains available for terminal-specific workflows. Account/enterprise features, managed policy, Claude Desktop computer-use integrations, and external plugin services cannot be enabled simply by selecting Fable in Orion.

## Validation

- Focused tests cover native image/PDF blocks, duplicate/missing files, exact content on the SDK input queue, question and permission replies, cancellation, stale/replayed replies, CLI version selection, effort/context mapping, and provider notices.
- Steering regression tests now execute their assertions, covering the active-turn interruption boundary, failed interruptions, retained background sessions, shell monitoring, and idle eviction.
- A real SDK 0.3.261 / bundled Claude Code 2.1.261 probe used a local mock Messages API. It confirmed native image delivery, `max` effort, the `AskUserQuestion` callback even in bypass-permission mode, answer delivery, and successful continuation. No paid model inference was used.
- The probe advertised native Task, Workflow, ListAgents, SendMessage, scheduling, web, shell, file, and Skill tools. Tool availability is verified; this is not an end-to-end execution test of each tool.
- Full-context compaction, days-long background work, real provider inference, account-gated services, and every third-party plugin were not exercised by this audit.

- Desktop component UI smoke test passed for multi-select, custom text, submission, and card removal. The macOS package built successfully, its signature verified, and the packaged Claude executable reported version 2.1.261.
