# Changelog

## 0.9.0 — 2026-10-01

- **Bump: sync upstream through v0.9.1** — require pi ≥0.86.1, update the Agent SDK to ^0.3.284 and development peers to pi 0.99.1; adopt catalog-driven models including Opus/Sonnet 5.5, transcript replay, session-safe mid-turn rebuilds, prompt-capture fixes, reasoning usage, and agent-dir logging while preserving Pi authentication, standalone completions, Max defaults, and the provider-only fork.

Entries below labelled **Upstream** are from `pi-claude-bridge`'s changelog; they were merged into this fork rather than published under this package name.

## Upstream 0.9.1 — 2026-09-30

- **Bump: Claude Sonnet 5.5 and pi-ai 0.99.1** — pi-ai update brings `claude-sonnet-5-5` with 1M context. Agent SDK now requires `^0.3.284`.
- **Tests: add PR CI** — Run unit tests on GitHub Actions without Claude credentials.
- **Fix: write the debug and diagnostics logs into pi's agent dir (#147)** — Honour `PI_CODING_AGENT_DIR` instead of always writing to (and recreating) `~/.pi/agent`; `CLAUDE_BRIDGE_DEBUG_PATH` still overrides the debug log. Thanks @Susensio.
- **Fix: unresolvable or refused system prompt ends the turn as a stream error (#124)** — The prompt-capture checks end the returned stream with an error event instead of throwing out of the provider call, so callers outside pi's agent loop see a failed turn too. The fallback to the freshest capture proposed in #124 is not included: an unmatched mid-query turn still fails, now as a failed turn rather than a throw. Thanks @jmtoepperwien.
- **Add: name pi#5581 when an extension-triggered turn's prompt can't be matched (#144)** — An idle `sendMessage` with `triggerTurn` skips `before_agent_start`, so its prompt lacks that turn's extension additions. The turn still fails, but the error now says so and suggests sending a user message instead.
- **Fix: thinking tokens never reached pi's `usage.reasoning` (#139)** — Read the SDK's nested `output_tokens_details.thinking_tokens`, as pi's own Anthropic provider does. Reasoning stays a subset of output tokens and out of cost. Thanks @cmembreno048.

## Upstream 0.9.0 — 2026-09-27

- **Bump: require pi ≥0.86.1 and drop pre-0.86 compat** — This breaks support for pi <0.86.1. Use pi-ai's transcript helpers and update dev peers to `^0.87.1` and the Agent SDK to `^0.3.280`; the API now rejects older Claude Code clients.
- **Fix: make mid-turn compaction rebuilds session-safe (issue #101)** — Restart parked queries from pi's rewritten history, with separate Claude Code mirrors per pi session. Prevents compaction loops and subagents taking over the parent's conversation; covered by `tests/int-compact-midturn-rebuild.mjs` and `tests/unit-cross-session-turns.mjs`. Thanks @andreypopp (PR #128), @chigkim, and @QuBiit0.
- **Fix: recover when a response stream stalls** — Accept Claude Code's non-streaming retry under a new message id and drop incomplete blocks from the stalled stream so tool calls reach pi. Covered by `tests/unit-nonstreaming-fallback.mjs`.
- **Fix: rebuild after an undelivered steer** — keep the rebuild request through successful completion, including on a first turn without a session mirror. Turn-level tests check that the next turn restores the missed message.
- **Fix: reject prompts that trigger Anthropic's third-party gate (issue #88)** — Refuse prompts carrying pi's harness or both documented trigger paths (`docs/custom-provider.md` and `docs/packages.md`) rather than risk a 400 or Extra Usage charge. See README.
- **Fix: AskClaude reports its effective configured defaults (issue #65)** — its schema, description, and TUI agree on mode and isolation; disabling full mode removes it from the enum. Thanks @fmguerreiro (PR #69).
- **Fix: honor unsupported per-model reasoning levels** — when pi-ai's `thinkingLevelMap` marks a level `null`, omit the effort setting instead of falling through to the generic mapping.
- **Add: Claude Opus 5.5 1M context (issue #116)** — Requires pi-ai ≥0.87.1.
- **Tests: strengthen integration and cache diagnostics** — Fail runs on bridge-origin `BUG:`/stranded-handler warnings; add an opt-in live-API git-commit cache test (`tests/int-cache-git.sh`) and a rebuild-fidelity probe. The probe confirms cache loss beyond the system prompt after rebuilds on CC 2.1.263+; see `diag/AUDIT.md`.

## Upstream 0.8.0 — 2026-09-20

- **Fix: pi 0.86 support (issues #106, #109)** — 0.86 moved the provider contract to `TranscriptContext`: the system prompt and tool set arrive as `role:"system"` messages, `context.systemPrompt`/`context.tools` are gone, and `summarizeForBugReport` joined as a fourth `streamFn` consumer. Every fresh session therefore took the rebuild path with zero records, wrote no session file, and failed with `WARNING session verify: file missing after save` followed by `No conversation found with session ID`. A new `src/transcript.ts` replays the transcript back into the 0.85-shaped `Context` at the stream entry points (and `syncSharedSession` filters system messages out of history), which also repairs what else 0.86 silently broke: skills/context files not projected to Claude Code (prompt capture resolved nothing), MCP tools never served — turns ran with no tools at all, and the model wrote tool calls out as prose rather than calling them — compaction and branch summaries throwing on their `[system,user]` context, and cursor arithmetic counting system messages. One-off summarizer calls — /bug has no takeover hook, and pi marks them all `cacheRetention: "none"` — now route to the isolated-summary path (separate CC process, no session sync), so a future summarizer consumer needs no bridge change. Sections are re-emitted in pi's canonical render order so the replayed prompt still matches the key prompt capture recorded (a section deleted and re-added — skills while `read`+`bash` are disabled — would otherwise land at the Map tail and fail every later turn). Mid-conversation system messages stay in the transcript space, never enter CC sessions, and the 0.85 path is byte-identical to before.
- **Add: the model picker is driven by pi-ai's catalog** — the hardcoded 8-model allowlist is gone, so a model Anthropic ships reaches `/model` as soon as pi-ai lists it, with no bridge change. Dated snapshot ids (`claude-opus-4-5-20251101`-style) stay hidden. `claude-bridge/claude-fable-5-1`, selectable as `fable` with 1M context, arrives this way.
- **Fix: 1M context goes only to models measured to serve it** — the `[1m]` id is no longer derived from pi-ai's declared window: an unentitled `[1m]` fails every turn, so only the measured set (Fable 5/5.1, Opus 5/4.8/4.7, Sonnet 5) gets it, and everything unmeasured serves the bare id at 200K until measured and added. Opus 4.7 now sends `[1m]`, Opus 4.5 and Sonnet 4.5 are newly selectable at 200K, Opus 4.6 and Sonnet 4.6 keep their plan gates, and an optimistic id can be pinned per-user with `provider.forceTwoHundredK`. Selection now prefers an exact id over a partial match, newest partial first.
- **Fix: subagent turns resolve their captured system prompt (issues #64, #91)** — captures now live in one process-wide registry, so isolated children (fresh module instances) resolve against it; `agent_start` records the prompt again after pi widens it with MCP tool descriptions, which is the prompt a subagent embeds verbatim at dispatch (measured 23,479 vs 10,988 chars at `before_agent_start`); and `turn_start` re-keys it so a mid-run re-render (tool-loadout change on 0.85.1) still resolves. A failed resolution now names the closest known capture, where it diverges and which boundary recorded it. Covered by `tests/unit-agent-start-capture.mjs`; the shapes still outside are pinned in `tests/unit-agent-start-capture-gaps.mjs` (tail-stripped inheritance #88, prompts composed outside pi's pipeline #102, prompts replaced between `turn_start` and the stream call #91).
- **Fix: claude-bridge models resolve in children given their own model registry (issue #91)** — a later bridge instance registers at `session_start` when its session's registry lacks the provider, instead of skipping registration unconditionally; it stays hands-off when the parent's registry is passed down, where re-registering would overwrite the parent's pinned stream fn. Every `claude-bridge/*` dispatch in such a child failed with "Model not found", frontmatter declaration included.
- **Fix: git-status changes no longer bust the prompt cache (issue #73)** — the `claude_code` preset embeds a git-status snapshot in the cached system block, so every git transition (new file, staging, commit) rewrote the whole conversation prefix at cache-write rates. The provider path now sets `includeGitInstructions: false`; it costs nothing there, since that path also runs CC with `tools: []`.
- **Fix: an exhausted subscription triggers fallback models (issue #58)** — Claude Code words a spent quota as "You're out of extra usage · resets 6:30pm", which matches none of the patterns retry logic (`fallbackModels`, key rotation) looks for, so the turn died as a plain error. A failure preceded by a rate-limit rejection is now labelled as one, with its limit type and reset time. Same code path: the warning no longer prints "1% used" at 98% or a 1970 reset time, and repeats only past a new 5% step rather than once per request.
- **Fix: better isolate AskClaude tool (issue #59)** — AskClaude children no longer inherit the user's `~/.claude` `CLAUDE.md` files or skill listing, and now always get Claude Code's system prompt preset instead of only when pi-side skills exist. Thanks @JAtkinsonKO.
- **Fix: bogus debug message about "record count mismatch" after switching providers** — the post-rebuild integrity check did not take `@file` expansion into account when switching providers.
- **Bump: pi-ai, pi-coding-agent and pi-tui to `>=0.85.0`** — the picker reads pi-ai's Anthropic catalog, and Fable 5.1 needs Claude Code 2.1.251+, so `@anthropic-ai/claude-agent-sdk` goes to `^0.3.267` (PR #94) and `@anthropic-ai/sdk` to `^0.124.0` (types only). With an older pi-ai the catalog yields nothing and the picker comes up empty; the bridge now says which dependency to update.
- **Tests: repair two suites** — session-resume's AskClaude turns now run after the first provider exchange (a second "recall the words" exchange in one transcript made the API refuse the request: "safeguards flagged this message"), and the branch-summary mock stubs `registerTool`, which `activate()` calls when AskClaude is enabled globally (PR #95).

## 0.8.6 — 2026-09-01

- **Fix: standalone extension completions no longer fail prompt capture** — tool-free one-shot `modelRegistry.complete()` calls marked no-cache, including pi-verbatim-compaction's planner, run in isolated Claude Code subprocesses with their supplied system prompt and never touch the resumable chat session. Pi compaction and branch summaries use the same route, replacing the competing event takeovers that caused duplicate summary calls when another compaction extension was installed.

## 0.8.5 — 2026-09-01

- **Bump: @anthropic-ai/claude-agent-sdk ^0.3.257** — bundled Claude Code 2.1.257, which accepts Fable 5.1. `@anthropic-ai/sdk` (types) moves to ^0.93.0 to match the SDK peer. If a model again outruns the bundle, the bridge still falls back to a current `claude` on PATH (or `provider.pathToClaudeCodeExecutable`) instead of repeating Claude Code's 400.

## 0.8.4 — 2026-09-01

- **Add: claude-fable-5-1 model** — Claude Fable 5.1 is selectable via `/model` and the `fable` shortcut now points to it. 1M context at standard rates (no Extra Usage). Adaptive thinking is always on (`xhigh` stays `xhigh`, thinking display is summarized even without an explicit effort). Session rebuilds drop thinking blocks because Fable 5.1 binds them to the conversation prefix and would 400 if we replayed them against a rewritten system prompt. Requires Claude Code 2.1.251+ (the bundled SDK CLI is older; set `provider.pathToClaudeCodeExecutable`). A catalog stub is used until pi-ai lists the id.

## 0.8.3 — 2026-09-01

- **Fix: first turn failed when the package was installed at both user and project scope** — pi's pre-trust pass loads the user copy (which registers the provider); the post-trust pass then loads the project copy and drops the first copy's `before_agent_start` handler. Captures were per-module, so the live stream saw an empty table and threw "0 known". The capture table is now process-wide, like the stream registration guard.

## 0.8.2 — 2026-08-28

- **Fix: git-status changes no longer bust the prompt cache (issue #73)** — the `claude_code` preset embeds a git-status snapshot in the cached system block, so any git transition rewrote the whole conversation prefix at cache-write rates. The provider path now sets `includeGitInstructions: false`, stripping the block with no other cost.
- **Fix: an exhausted Claude subscription never triggered fallback models (issue #58)** — a failure preceded by a rate-limit rejection is now labelled as one, with its limit type and reset time. Rate-limit warnings show true percentages (the SDK reports utilization as a fraction), skip a 1970 reset time, and only re-notify when usage rises past a new 5% step. The labelled error is consumed with the failure that caused it, so a later unrelated error is not also tagged as a rate limit.
- **Fix: system prompt loading** — Claude Code no longer loads its own `CLAUDE.md` (`claudeMdExcludes`); context files and skills come from pi. `provider.appendSystemPrompt` / `provider.settingSources` are gone. An unaccountable system prompt now fails loudly instead of silently dropping instructions, and a sub-agent cannot clobber its parent's captured prompt.
- **Fix: branch summarization ran through the live provider** — rewinding or forking with "summarize" now takes over `session_before_tree` the way `/compact` already takes over `session_before_compact`.
- **Fix: `@file` mentions were lost when a session was rebuilt** — Claude Code expansions are now carried across. Requires cc-session-io `^0.4.0`. Empty aborted turns are dropped instead of standing in as `[incompatible content omitted]`, and conversion logs what it discarded.
- **Fix: bogus "record count mismatch" after switching providers** — the post-rebuild integrity check now accounts for `@file` expansion.
- **Fix: unparseable `claude-bridge.json` is left alone** — recording the startup notice no longer overwrites a config that does not parse.
- **Bump: cc-session-io ^0.4.0, pi 0.83.0** — `@anthropic-ai/sdk` moves to devDependencies (types only).

## 0.8.1 — 2026-08-06

- **Fix: default plan is Max; brand notices as pi-claude-agent-sdk** — `provider.plan` now defaults to `"max"` so Max subscribers get Opus 4.6 at 1M without config. The one-time notice tells Pro users to set `"pro"`. User-facing notifications use the package name instead of "Claude bridge".

## 0.8.0 — 2026-08-06

- **Remove: AskClaude tool** — remove the delegated Claude Code tool, its configuration, UI, and integration coverage; the package now only registers the Claude bridge provider.

## 0.7.1 — 2026-08-06

- **Fix: cross-model interoperability and Pi authentication** — Agent SDK children now require Pi's refreshed Anthropic OAuth credential (or API key) and ignore Claude Code login and inherited authentication settings. Rebuilt Claude sessions also bound foreign tool-call IDs to Anthropic's 64-character format and disambiguate IDs that would otherwise collide after sanitization. Unit regressions pin both handoff directions, and RPC integration alternates Claude with a non-Claude model after parallel and sequential tools.

## 0.7.0 — 2026-08-05

First release under the name `pi-claude-agent-sdk` (forked from `pi-claude-bridge`). Install with `pi install npm:pi-claude-agent-sdk`.

- **Fix: mirror Pi context-file instructions** — Claude Code now receives the same global and hierarchical `AGENTS.md` / `CLAUDE.md` files that Pi loads, in the same order, rather than only the nearest `AGENTS.md`.
- **Add: mid-turn steering** — a steer sent while a tool was running used to be stashed and replayed as a follow-up after Claude's whole turn finished. The prompt is now a long-lived streaming generator and the steer is written to CC's stdin (`priority: "next"`) before the tool result is released, so CC drains it at that tool boundary and acts on it in the same turn.
- **Add: one-time plan notice** — `provider.plan` defaults to `"pro"`, so Max subscribers silently lost Opus at 1M context. Notifies once, on the first bridge query of an interactive session, when `plan` is unset.
- **Fix: images dropped from prompts and rebuilt sessions (issue #34)** — an image followed by a trailing text preview lost the image, and tool results carrying images were flattened to text whenever the bridge rewrote pi's history into a Claude Code session. Images survive both paths now; requires cc-session-io `^0.3.2`.
- **Fix: a turn that failed at a tool boundary ended silently** — once a turn ended on a tool call its pi stream is closed, and the guard that suppresses content events for a closed stream also swallowed the `result` message, so a 429 or overload mid-tool set no `stopReason`, no `errorMessage`, and logged nothing. The failure and the served context window are now recorded above that guard, as are rate-limit notifications, which were dropped whenever a tool was in flight.
- **Fix: a reentrant subagent could disturb the parent's session** — the shared session cursor was written from whichever context delivered tool results, so a background subagent dragged the parent's cursor backwards and cost its next turn a full rebuild and a flushed prompt cache. Removal from the active-context set is now guarded like the cleanups beside it, and an orphaned tool result no longer resets the live top-level context's turn state.
- **Fix: session rebuilds destroyed the results of parallel tool calls** — pi records one message per tool result, and `repairToolPairing` (applied inside `Session.importMessages`, so unavoidable) only pairs results sharing the user message right after their assistant message; it dropped every result past the first, substituting `[no tool result recorded]`. The conversion now collects a turn's results into one message placed directly after its assistant message, so a mid-turn steer landing before or between them no longer strands the results behind it.
- **Fix: bridge can deadlock when Claude hallucinates a tool name** — Claude called `bash` instead of `mcp__custom-tools__bash`, CC rejected it with "No such tool available" and retried under a fresh tool_use id, but the bridge had already run the rejected call in pi — so the retry's MCP handler waited on a result that never came and the turn stalled until it aborted. Tool calls for anything the bridge does not serve over MCP are now ignored.
- **Fix: rebuilds named unserved tools after Claude Code builtins** — the provider path runs with `tools: []`, but a tool call in pi's history that the current tool set no longer covers (AskClaude, which is excluded on purpose, or a disabled extension) was written into the transcript as `Bash`/`Read`/`Edit`/`Write` — telling the model a builtin it cannot call was available and used, the same prompt condition behind the phantom-call deadlock. Those names now stay in the `mcp__custom-tools__` namespace, and a name that already carries that prefix throws instead of being pascalCased into `McpCustomToolsBash`.
- **Fix: nested tool schemas flattened (issue #44)** — converting pi schemas to Zod collapsed nested objects and dropped `anyOf`/`const`, so Claude saw only the top level of tools like `edit` and `subagent`. The MCP server now serves pi's JSON Schema verbatim.
- **Fix: tool results paired by call order** — MCP handlers took their `toolCallId` from a positional cursor, so a call arriving out of order silently paired its result with the wrong tool call. Now pairs by Claude's `_meta["claudecode/toolUseId"]` and fails loudly if it is absent.
- **Fix: `--system-prompt` and `--append-system-prompt` silently ignored** — the bridge forwarded only AGENTS.md and skills, so the user's own prompt text never reached the model. Both are now appended to Claude Code's preset, regardless of the `appendSystemPrompt` setting.
- **Fix: API errors reported as a successful turn (issue #43)** — CC flags failures with `is_error` on a result whose subtype is still `"success"`, so the bridge duplicated the error text and finalized as a normal stop. Failed results now end the turn with `stopReason: "error"`, and the compact-summary path no longer accepts an errored result as a summary.
- **Fix: rebuilt sessions recorded the bare model id (issue #42)** — session rebuilds wrote pi's model id into the Claude Code transcript instead of the resolved CLI id, dropping the `[1m]` suffix. Metadata only; the served model and context window come from `--model`, which was already correct.
- **Tests: queue tests now run against the real code** — `tests/unit-queue.mjs` asserted against a hand-written model of the tool-result queue, which pairs by id by construction and so stayed green throughout the mispairing bug fixed in `fc2efeb6`. Rewritten to drive the real MCP handler over JSON-RPC and the real `deliverToolResults`: 549 lines and 30 scenarios become 234 and 9, and reintroducing the original bug now turns them red.
- **Tests: correctness audit tooling** — `diag/audit-{transcripts,cache,warnings}.mjs` scan session transcripts and the bridge log for silent data loss, prefix-cache breaks and stranded tool handlers, gated on `--since` so a clean run is achievable; `diag/replay-write-path.mjs` replays any pi session through the rebuild. `tests/int-cc-contracts.mjs` pins the undocumented Claude Code behavior the bridge depends on against the installed SDK, and `tests/unit-convert-determinism.mjs` pins that a rebuild is deterministic and extends the previous transcript rather than rewriting it.
- **Fix: Claude Code wrote auto-memory from bridge turns** — provider and AskClaude queries now disable auto-memory through the SDK's highest-priority settings layer by default; set `provider.autoMemoryEnabled` to `true` to opt in. Isolated compaction queries always disable it.
- **Tests: recorded SDK stream fixtures** — `consumeQuery` was only ever tested against hand-written SDK messages, which cover the shapes we expected rather than the ones Claude Code sends (a real stream carries `system/status` frames and a `rate_limit_event` every turn). `tests/lib/record-sdk-streams.mjs` captures verbatim streams and `tests/unit-stream-replay.mjs` replays them through the real code; the recorder scrubs the cwd, uuids and the user's slash-command list, and refuses to write a fixture the username survived. The `int-session-resume` AskClaude flake is fixed too, by asserting on the tool call's prompt args instead of the response alone.
- **Tests: query teardown** — the queue rewrite dropped the old synthetic drain scenarios without recording the gap, so nothing covered what happens to a parked MCP handler when its query goes away. The three copies of that teardown are now one `QueryContext.releasePendingToolCalls`, the abort composition is `drainForAbort`, and `tests/unit-queue.mjs` drives both against the real handler — including the abort race where delivery is parked on a steer's stdin ack. `tests/int-shutdown-kills-cc.mjs` additionally pins that a pi shutdown and a user abort each reap the Claude Code subprocess with a tool call in flight, which no test asserted before.
- **Tests: harness hygiene** — the unit suite redirects the debug log via a preloaded `tests/lib/setup.mjs` so no test can write to the real bridge log, and the integration harness now fails fast when `~/.claude` is unwritable instead of surfacing a confusing resume error much later. Bash integration scripts autoload `.env.test` like the RPC harness already did, and two assertions that depended on model whim were dropped or tightened.

## 0.6.3 — 2026-07-26

- **Add: claude-opus-5 model** — Claude Opus 5 is selectable via `/model` and the `opus` shortcut now points to it.
- **Bump: pi >=0.82.1** — required for the `claude-opus-5` model catalog entry.
- **Internal: remove obsolete QueryContext stack** — remove the unused push/pop/depth infrastructure superseded by `activeQueryContexts`.

## 0.6.2 — 2026-07-06

- **Fix: Sonnet 5 and Fable 5 with 1M context** — bare model IDs (`claude-sonnet-5`, `claude-fable-5`) are 200K context. Must pass `[1m]` suffix for both, similar to Opus 4.8.
- **Fix: xhigh thinking level hidden for Sonnet 5 and Sonnet 4.6 (issue #32)** — pi-ai ships no `thinkingLevelMap` for these models, and pi's `getSupportedThinkingLevels` requires an explicit mapping to show `xhigh` in the picker. This is a workaround for https://github.com/earendil-works/pi/issues/6371

## 0.6.1 — 2026-07-01

- **Add: claude-fable-5 and claude-sonnet-5 models** — Anthropic's Claude Fable 5 (released 2026-06-09) and Sonnet 5 (released 2026-06-30) are now selectable via `/model`. Both force adaptive thinking. The `fable` and `sonnet` shortcuts resolve to these new models.
- **Bump: pi-ai >=0.80.3** — required for claude-fable-5 and claude-sonnet-5 model catalog entries.

## 0.6.0 — 2026-06-29

- **Fix: `/compact` hang (issue #18)** — the bridge now owns compaction for claude-bridge models, running split-turn summaries as isolated Claude Code subprocesses instead of routing them through the live provider stream. File ops (`<read-files>`/`<modified-files>`) carry forward across compactions. If compaction fails it is cancelled with a notification rather than falling back to the buggy native path.
- **Fix: subagent routing (issue #19)** — provider calls from subagents while a parent query is active now start a nested query instead of being mistaken for empty tool-result delivery.
- **Fix: session preservation across `/compact` and tree nav (issue #25)** — the main Claude Code session is no longer clobbered by shorter synthetic contexts (compact summaries) or stale post-rewrite history.
- **Add: plan-aware 1M context (issue #24)** — new `provider.plan` (default `"pro"`) and `provider.longContextExtraUsage` config. See README for which models get 1M on which plan.
- **Add: reasoning token tracking** — Claude Code `reasoning_tokens`/`thinking_tokens` are preserved on pi usage objects and in debug logs.
- **Bump: pi 0.80 APIs** — compat catalog import, `CONFIG_DIR_NAME`, compaction metadata. Claude Agent SDK 0.2.x, TypeBox 1.3, tsx 4.22.

## 0.5.0 — 2026-06-05

- **Add: claude-opus-4-8 model** — migrated pi imports/dev peers from deprecated `@mariozechner/*` packages to `@earendil-works/*` 0.78.x so the official pi-ai registry supplies Opus 4.8. The `opus` shortcut now resolves to 4.8; 4.7/4.6 remain available for explicit pinning.
- **Docs: Agent SDK quota warning** — note Anthropic's announced June 15, 2026 Agent SDK billing/quota change.
- **Tests: isolate AskClaude config** — AskClaude integration tests now use project-local test config so they are unaffected by a user's global `askClaude.enabled` setting.
- **Tests: harden shell integration tests** — use explicit alternate provider/model settings and pre-increment counters under `set -e`.

## 0.4.0 — 2026-05-04

- **Fix: Opus 4.7 + xhigh sent wrong effort to SDK** — pi-ai 0.72 ships per-model `thinkingLevelMap` overrides (e.g. `claude-opus-4-7` declares `xhigh→xhigh`, not `xhigh→max`), but our hardcoded `REASONING_TO_EFFORT` table ignored them. Effort lookup now consults `model.thinkingLevelMap` first, falls back to the table for older pi-ai or unmapped levels. Forwarded `thinkingLevelMap` through `buildModels` projection.
- **Fix: zero out model cost in `buildModels`** — per-token pricing in the footer was wrong because models inherited pi-ai's non-zero cost fields, which pi then multiplied by the huge token counts from the SDK. Now explicitly zeroed so pi's footer shows no cost.
- **Use `tools: []` instead of `disallowedTools` blocklist** — switch from blocking specific tools to explicitly passing an empty tools list, preventing any new default tools from silently leaking into bridge sessions.
- **Disable CC-side autocompact (`DISABLE_AUTO_COMPACT=1`)** — pi already owns context management and propagates its own `/compact` to CC. Letting CC autocompact too double-flushed the prompt cache and raced pi's threshold; manual `/compact` in CC is unaffected.
- **Fix: pi `/compact` no longer triggers CC autocompact-thrashing (issue #8)** — pi's compaction shrinks its messages array, but `syncSharedSession`'s REUSE check (`slice(cursor)`) silently returned `[]`, so the bridge kept `--resume`ing the pre-compact CC session JSONL. Over long sessions CC's own autocompact then refilled within 3 turns and tripped its anti-thrashing guard. Now subscribes to pi's `session_compact` event and forces the next sync down the REBUILD path so CC sees the post-compact history. Also subscribes to `session_tree` (branch nav has the same shape).
- **Refactor: split `needsRebuild` into `needsRebuild` + `forceRotate`** — only the abort case needs UUID rotation (to dodge late writes from the dying CC subprocess). Compact/tree now rebuild in place, preserving the sessionId and not leaking orphan JSONL files into `~/.claude/projects/`.
- **Block user-installed MCP servers from leaking into bridge sessions** — pass `--strict-mcp-config` unconditionally and set `ENABLE_CLAUDEAI_MCP_SERVERS=0` in the spawned CC env, suppressing both filesystem (`~/.claude.json`, `.mcp.json`) and claude.ai cloud MCP servers. Override with `provider.strictMcpConfig: false`.
- **Consolidate config** — SDK plumbing (`appendSystemPrompt`, `settingSources`, `strictMcpConfig`) moved from `~/.pi/agent/settings.json` (`claudeAgentSdkProvider` block) to a `provider` block in `~/.pi/agent/claude-bridge.json`. Old location no longer read. Drop deprecated, unsafe `maxHistoryMessages`.
- **Bump deps** — `@anthropic-ai/claude-agent-sdk` → ^0.2.126; migrate to TypeBox 1.x (new import paths per pi-mono 0.69); pi devDeps → ^0.72.1. Extract `registerTool` schemas to const with explicit `<typeof params>` generic to avoid TS2589 deep-instantiation under TypeBox 1.x.
- **Internal: move sources into `src/`** — `index.ts` and the extracted modules now live under `src/`; screenshots under `assets/`. `pi.extensions` and published `files` updated accordingly.

## 0.3.1 — 2026-04-18

- **Fix: empty thinking blocks on Opus 4.7** — Opus 4.7 silently changed default `thinking.display` from `"summarized"` to `"omitted"`, so streams emitted `thinking_start` + `signature_delta` with zero `thinking_delta` events, leaving `ThinkingBlock.thinking == ""`. Now pass `--thinking-display=summarized` via `extraArgs` whenever `effort` is set (both provider and AskClaude paths). Bump `@anthropic-ai/claude-agent-sdk` to ^0.2.111 (required for Opus 4.7 + `--thinking-display` CLI flag). See [anthropics/claude-agent-sdk-python#830](https://github.com/anthropics/claude-agent-sdk-python/pull/830).
- **Fix: `cachePct` debug metric misleading** — denominator was `input + cacheRead`, so once a conversation warmed up (tiny `input`, huge `cacheRead`) every turn rounded to 100% — even turns that rebuilt the cache from scratch. Now `cacheRead / (input + cacheRead + cacheWrite)`, so cache-rebuild turns show a low percentage.
- **Internal: extract pure modules from `index.ts`** — split `models`, `skills`, `session-verify`, `extract-tool-results`, and `query-state` into their own TS files with real unit tests (no more `.js`+`.d.ts` mirror drift). Add `typecheck` script, `typescript` + `tsx` devDeps; test scripts run via `--import tsx`.

## 0.3.0 — 2026-04-17

- **Add: claude-opus-4-7 model** — Added `claude-opus-4-7` as a selectable model. The `opus` shortcut now resolves to 4.7 by default; 4.6 remains available for explicit pinning. Bumped `@mariozechner/pi-ai` to ^0.67.6 to include official model definitions (removed fallback).
- **Refactor: QueryContext class replaces module-level state** — 12 mutable `let` variables + manual `SavedQueryState` push/pop replaced with a `QueryContext` class and context stack. Adding new per-query state is now 1 property instead of 6 edit sites. Fixes `deferredUserMessages` not being isolated across reentrant queries (subagent could consume parent's deferred steers). MCP handlers now close over captured context, abort handler captures context at the correct point after push.
- **Fix: MODELS baseUrl leak** — the MODELS array exported to pi's provider registration now projects only the fields pi needs (id/name/reasoning/input/cost/contextWindow/maxTokens), stripping pi-ai's `baseUrl`/`api`/`provider`/`headers` so they can't shadow the values `registerProvider` supplies.
- **Internal: `repairToolPairing` moved to cc-session-io 0.3.0**; convert logic extracted to `convert.js` with `convert.d.ts` types; various dead-code / type-safety cleanup.

## 0.2.0 — 2026-04-15

- **Fix: stale cursor after tool-using first turn (issue #4)** — after the first turn used tools, the session cursor pointed at the wrong message, causing Claude to re-process stale context. Now correctly advances past all tool_result blocks.
- **Fix: session resume on symlinked paths / CLAUDE_CONFIG_DIR** — cc-session-io now resolves symlinks (realpathSync + NFC) and honors `CLAUDE_CONFIG_DIR`, matching how Claude Code resolves session paths. Fixes "No conversation found" on macOS symlinked dirs. Bump cc-session-io → 0.2.0.
- **Verify-after-write for session files** — warns with diagnostic context if the written session file doesn't round-trip correctly, instead of letting Claude silently resume a corrupt session.
- **Session rebuild preserves sessionId** — provider switches no longer churn UUIDs.
- **CC CLI debug capture** — `CLAUDE_BRIDGE_DEBUG=1` now also writes Claude Code's own debug stream to `~/.pi/agent/cc-cli-logs/`, one file per query.
- **Fix: debug() logged Error objects as `{}`** — now formats with message and stack.
- **Repair orphan tool_use/tool_result pairs before import** — prevents potential API 400s when history starts mid-turn after a provider switch.

## 0.1.6 — 2026-04-10

- **Fix: steer messages during tool execution now reach Claude** — when a user sends a steer while a tool is executing, pi injects it into context alongside the tool result. The bridge previously only processed tool results in this path, silently dropping the steer. Now detected and replayed as a continuation query after the current query completes.
- **Fix: "No conversation found with session ID" in dirs with dots/underscores/spaces** — bump `cc-session-io` to 0.1.2; `projectPathToHash` now matches the CLI's sanitization (`/[^a-zA-Z0-9]/g` → `-`) instead of only replacing slashes
- **Fix: steer/followUp during tool execution no longer hangs** — `extractAllToolResults` now walks past injected user messages instead of stopping at them
- **ID-based tool result matching** — tool results are matched to MCP handlers by `toolCallId` instead of FIFO position; eliminates silent wrong-result delivery if order diverges
- Add integration tests for tool execution scenarios (normal, followUp, steer, parallel+steer, abort) with auto-restart on failure
- Add `defaultIsolated` config option for AskClaude
- Remove skill path aliasing (`.pi/` → `.claude/` round-trip); pass through real paths instead
- Rewrite skills block to reference MCP-bridged read tool (`mcp__custom-tools__read`)
- **Fix: AskClaude action summary showed raw SDK tool names** — normalize `mcp__custom-tools__*` and SDK names at creation; hide redundant `BashOutput` and recursive `AskClaude`; collapse only consecutive same-tool calls
