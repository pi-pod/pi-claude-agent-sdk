# pi-claude-agent-sdk

[![npm version](https://img.shields.io/npm/v/pi-claude-agent-sdk)](https://www.npmjs.com/package/pi-claude-agent-sdk)

Pi extension that integrates Claude Code as a pi model provider via the [Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript). Forked from [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge) by Eli Dickinson, which was based initially on [claude-agent-sdk-pi](https://github.com/prateekmedia/claude-agent-sdk-pi) by Prateek Sunal. Adds streaming, MCP tool bridging, custom pi tool bridging, session resume/persistence, context sync, thinking support, and skills forwarding.

Use Opus/Sonnet/Haiku as models in pi, with all tool calls flowing through pi's TUI.

**FYI:** Anthropic [announced and then unannounced](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) a change to how you would be billed for tools that use the Agent SDK like this one. It currently uses your regular subscription quota just like Claude Code.

<p>
<a href="assets/claude-bridge1.png"><img src="assets/claude-bridge1.png" width="49%"></a>&nbsp;
<a href="assets/claude-bridge2.png"><img src="assets/claude-bridge2.png" width="49%"></a>
</p>

## Install

```
pi install npm:pi-claude-agent-sdk
```

Requires pi 0.86.1 or newer.

## Provider

Use `/model` to select any Claude model in pi-ai's catalog, e.g. `claude-bridge/claude-fable-5-1`, `claude-bridge/claude-opus-5`, or `claude-bridge/claude-haiku-4-5`.

Fable 5.1 needs Claude Code **2.1.251 or newer**. If an explicitly configured CLI is too old, the bridge can use a current `claude` on PATH.

Behind the scenes, pi's tools are bridged to Claude Code but everything works like normal in pi. Bash commands get Claude Code's 120-second default timeout since pi's bash has none. Skills are forwarded to Claude Code's system prompt, and steering mid-turn reaches Claude at the next tool boundary.

**Authentication:** the bridge requires an Anthropic OAuth credential (or API key) configured in Pi and uses Pi's token refresh, renewing an OAuth token with less than two hours left before it starts a Claude Code turn (a turn keeps the token it started with). Claude Code login and inherited Claude/Anthropic authentication settings are deliberately ignored, so configure Anthropic authentication in Pi before using the provider.

The model list comes from pi-ai's Anthropic catalog automatically — when pi-ai adds a new Claude model, it appears in `/model` after updating the package, no bridge update needed. Dated snapshot ids (e.g. `claude-opus-4-5-20251101`) are not shown.

**1M Context:** Fable 5/5.1, Opus 5.5/5/4.8/4.7, and Sonnet 5.5/5 get 1M context. Opus 4.6 gets 1M only on a Max plan or with Extra Usage, and Sonnet 4.6 only with Extra Usage — set `provider.plan` and/or `provider.longContextExtraUsage` as described in [Configuration](#configuration).

## Configuration

Config: `~/.pi/agent/claude-bridge.json` (global) or the project Pi config directory, usually `.pi/claude-bridge.json` (project; merged over global).

```json
{
  "provider": {
    "plan": "max",
    "longContextExtraUsage": false,
    "strictMcpConfig": true,
    "pathToClaudeCodeExecutable": "/home/you/.nix-profile/bin/claude"
  }
}
```

`provider`:
- `plan` (default `"max"`) — Max (or Team Premium/Enterprise). Set to `"pro"` on a Pro plan so Opus 4.6 stays at 200K context. If it's unset, the first interactive session points this out once, then records `startupNoticeShown` (the date, `YYYY-MM-DD`) in the global config so it doesn't nag again.
- `longContextExtraUsage` — set to `true` to enable 1M models that cost money through Extra Usage. It enables Sonnet 4.6 with 1M on every plan and Opus 4.6 with 1M on Pro. Not needed for Opus 4.7 or 4.8.
- `forceTwoHundredK` — array of model ids to pin to 200K context (bare id, no `[1m]` suffix).
- `strictMcpConfig` — block MCP servers from `~/.claude.json` / `.mcp.json` (default `true`). Cloud MCP (Gmail/Drive via claude.ai OAuth) is always blocked.
- `autoMemoryEnabled` — enable Claude Code's auto-memory system (default `false`)
- `pathToClaudeCodeExecutable` — path to the `claude` binary. Useful if your OS/filesystem has the SDK's bundled musl/glibc binaries in a place where they can't run, or to pin a specific CLI. For example, with Nix you can set the binary to e.g. `"/home/you/.nix-profile/bin/claude"`.

**Extension providers and models.json:** pi's `modelOverrides` in `~/.pi/agent/models.json` do not currently apply to extension-registered providers (like claude-bridge). Overriding `contextWindow` or other fields requires editing `src/models.ts` directly — to pin a model to 200K, use `provider.forceTwoHundredK` instead.

## Tests

`npm run test:unit` for offline tests (`tests/unit-*.mjs`: queue, import, skills).

`npm test` for the full suite, which adds integration tests that hit APIs (`tests/int-*.{sh,mjs}`: smoke, multi-turn, cache, session-resume, session-rebuild, tool-message). Set `CLAUDE_BRIDGE_TESTING_ALT_PROVIDER` and `CLAUDE_BRIDGE_TESTING_ALT_MODEL` in `.env.test` for the provider-switch tests.

Integration tests spawn real `pi` and Claude Code subprocesses, so they need write access to `~/.claude` for CC's session state — a sandbox that blocks it makes the next turn's `--resume` fail with `No conversation found with session ID`. The RPC harness probes for this at startup and fails fast.

## Debugging

Set `CLAUDE_BRIDGE_DEBUG=1` to enable debug output:

- **Bridge log** at `claude-bridge.log` in pi's agent dir (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`) — provider calls, session sync decisions, tool results, CC stderr. Override location with `CLAUDE_BRIDGE_DEBUG_PATH`.
- **Per-query CC CLI logs** at `cc-cli-logs/<timestamp>-<tag>-<seq>.log` in the same directory — the subprocess's own debug stream; tag is `provider` or `standalone`. Shows CC's view of session loading, API requests, and tool calls.

When filing a bug about a session-resume failure (e.g. "No conversation found"), the most useful attachments are the `syncResult:` lines from the bridge log plus the matching `cc-cli-logs/` file for the failing query.

## Compatibility with other extensions

### Which injection routes reach Claude Code

The bridge forwards pi's structured parts — project context files, skills, custom prompt, appended instructions — and drops the rest. Measured against the request body (`diag/capture-proxy.mjs`):

| Route | Reaches Claude Code |
|---|---|
| `before_agent_start` -> `message` | Yes, as literal prompt text in the user turn |
| `context` editing the last user message | Yes, as literal prompt text |
| `--append-system-prompt` | Yes, with pi's appended instructions |
| `context_with_system` editing the system message | Yes when it wraps pi's prompt; the turn fails when it replaces one |
| `before_agent_start` -> `systemPrompt` | No, dropped |

Two traps. Returning `systemPrompt` from `before_agent_start` makes pi replace the whole system prompt, discarding any `context_with_system` edit in the same run — only one reaches the request. And system-prompt edits work by *wrapping*: replacing pi's prompt leaves the bridge with nothing to match, so it refuses the turn rather than send Claude Code a request missing your context files, skills and custom instructions. The error names the closest known prompt and where it diverged.

To add instructions, use `message`, `context`, or a system-message edit that keeps pi's prompt intact.

### Hooks written for Claude Code

`~/.claude/settings.json` hooks fire inside bridge turns, so a hook injecting Claude-specific guidance duplicates what pi's extensions already provide. pi sets `PI_CODING_AGENT=true` for child processes, including the Claude Code child; a hook can skip itself on that:

```sh
[ -n "$PI_CODING_AGENT" ] && exit 0
```

Hooks do not fire on the compact-summary side query.

### System prompt rejections

Other extensions can change the system prompt. When the result still contains pi's built-in system prompt text, or the two documentation paths that Anthropic looks for (`docs/custom-provider.md` in the same prompt with `docs/packages.md`), the bridge stops the turn instead of sending it, since Anthropic may otherwise bill these requests as Extra Usage. Fix the source extension before retrying; `CLAUDE_BRIDGE_DEBUG=1` writes the full prompt to the bridge log when this happens.

### Using claude bridge with @gotgenes/pi-subagents

Requires the following in `~/.pi/agent/subagents.json`:

```json
{"promptInheritance": {"claude-bridge": "portable"}}
```

## Known issues

**A session rebuild re-sends the whole conversation.** The bridge rewrites Claude Code's session from pi's history whenever the two diverge — after an abort, `/compact`, tree navigation, an API error, or on returning to a session — and the next request usually misses the prompt cache for everything past the system prompt. Abort-heavy sessions cost noticeably more.

**Files Claude Code edits are not carried across a rebuild.** The edit itself survives in the history as a tool call and result — what's lost is the post-edit file snapshot. `@file` expansions *are* carried.

**System prompt changes mid-session may not reach the model.** The bridge keeps Claude Code's default prompt recording: project context (AGENTS.md/CLAUDE.md), skills, and extension-written instructions are captured on the first request and reused on resume. This keeps the cached prefix stable, but later changes may not take effect until a rebuild or compaction. Start a new session if updated instructions must take effect immediately.

**Exported Anthropic environment variables override the Claude Code child (issue #107).** An exported `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, or `ANTHROPIC_AUTH_TOKEN` redirects Claude Code to that gateway and every turn fails with its auth error. Unset them for the pi process.
