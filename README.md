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

## Provider

Use `/model` to select `claude-bridge/claude-fable-5-1`, `claude-bridge/claude-fable-5`, `claude-bridge/claude-opus-5-5`, `claude-bridge/claude-opus-5`, `claude-bridge/claude-opus-4-8`, `claude-bridge/claude-opus-4-7`, `claude-bridge/claude-opus-4-6`, `claude-bridge/claude-sonnet-5`, `claude-bridge/claude-sonnet-4-6`, or `claude-bridge/claude-haiku-4-5`. The `fable` shortcut resolves to Fable 5.1 and the `opus` shortcut to Opus 5.5. Fable 5.1 needs Claude Code **2.1.251 or newer** (the SDK's bundled CLI is 2.1.257). If you point `provider.pathToClaudeCodeExecutable` at an older binary, or a later model outruns the bundle, the bridge uses a current `claude` on PATH when it finds one.

Behind the scenes, pi's tools are bridged to Claude Code but it should all work like normal in pi. Bash commands get a 120-second default timeout (matching Claude Code's default) since pi's bash has no timeout by default. Skills in pi are copied over to Claude Code's system prompt so should work as they would with any other pi provider. Steering works mid-turn: a message sent while Claude is running a tool reaches it at that tool boundary, not after the whole turn finishes.

**Authentication:** the bridge requires an Anthropic OAuth credential (or API key) configured in Pi and uses Pi's normal token refresh. Claude Code login and inherited Claude/Anthropic authentication settings are deliberately ignored, so configure Anthropic authentication in Pi before using the provider.

**1M Context:** Fable 5.1, Fable 5, Opus 5.5, Opus 5, Opus 4.8, and Opus 4.7 get 1M context by default. Opus 4.6 only gets 1M if you're on a Max plan or pay for Extra Usage. Sonnet 4.6 only gets 1M if you pay for Extra Usage. You will need to set `provider.plan` and/or `provider.longContextExtraUsage` for 1M context in Opus 4.6/Sonnet 4.6 as described in [Configuration](#configuration).

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
- `strictMcpConfig` — block MCP servers from `~/.claude.json` / `.mcp.json` (default `true`). Cloud MCP (Gmail/Drive via claude.ai OAuth) is always blocked.
- `autoMemoryEnabled` — enable Claude Code's auto-memory system (default `false`)
- `pathToClaudeCodeExecutable` — path to the `claude` binary. Useful if your OS/filesystem has the SDK's bundled musl/glibc binaries in a place where they can't run, or to pin a specific CLI. For example, with Nix you can set the binary to e.g. `"/home/you/.nix-profile/bin/claude"`.

**Extension providers and models.json:** pi's `modelOverrides` in `~/.pi/agent/models.json` do not currently apply to extension-registered providers (like claude-bridge). Overriding `contextWindow` or other fields requires editing `src/models.ts` directly.

## Tests

`npm run test:unit` for offline tests (`tests/unit-*.mjs`: queue, import, skills).

`npm test` for the full suite, which adds integration tests that hit APIs (`tests/int-*.{sh,mjs}`: smoke, multi-turn, cache, session-resume, session-rebuild, tool-message). Set `CLAUDE_BRIDGE_TESTING_ALT_PROVIDER` and `CLAUDE_BRIDGE_TESTING_ALT_MODEL` in `.env.test` for the provider-switch tests.

Integration tests spawn real `pi` and Claude Code subprocesses, so they need write access to `~/.claude` for CC's session state — a sandbox that blocks it makes the next turn's `--resume` fail with `No conversation found with session ID`. The RPC harness probes for this at startup and fails fast.

## Debugging

Set `CLAUDE_BRIDGE_DEBUG=1` to enable debug output:

- **Bridge log** at `~/.pi/agent/claude-bridge.log` — every provider call, session sync decision, tool result delivery, and CC's stderr. Override location with `CLAUDE_BRIDGE_DEBUG_PATH`.
- **Per-query Claude Code CLI logs** at `~/.pi/agent/cc-cli-logs/<timestamp>-<tag>-<seq>.log` — the CC subprocess's own debug stream, one file per `query()` call. Tags are `provider` (resumable main turn) or `standalone` (compaction, branch summary, and tool-free extension-owned no-cache completion). Useful when a resume fails or CC misbehaves internally — shows the CLI's own view of session loading, API requests, and tool calls.

When filing a bug about a session-resume failure (e.g. "No conversation found"), the most useful attachments are the `syncResult:` lines from the bridge log plus the matching `cc-cli-logs/` file for the failing query.

## Known issues

**Sessions get rebuilt more often than they need to be, and a rebuild is expensive.** The bridge rewrites Claude Code's session from pi's history whenever pi's messages move underneath it — after an abort, `/compact`, tree navigation, or an API error. Measured over this repo's own bridge log, a rebuild boundary loses the prompt cache roughly 58% of the time against 26% for a plain resume, so an abort-heavy session costs noticeably more than a clean one. Aborts alone are 46% of rebuilds.

**Files Claude Code edits are not carried across a rebuild.** CC records the post-edit contents as an `edited_text_file` attachment; those aren't carried, because they hang off a tool-result record rather than a prompt and so have no stable position to restore them to. The edit itself survives — it's in the history as a tool call and its result — so this costs Claude the file snapshot, not the knowledge that it made the change. `@file` expansions *are* carried.
