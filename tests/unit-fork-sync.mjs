import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import activate, { __test } from "../src/index.js";
import { convertPiMessages } from "../src/convert.js";
import { buildClaudeChildEnv } from "../src/child-env.js";

let provider;
const registeredTools = [];
activate({
	on() {},
	registerProvider(_id, config) { provider = config; },
	registerTool(tool) { registeredTools.push(tool); },
});
const model = { ...provider.models.find((m) => m.id === "claude-haiku-4-5"), api: "claude-bridge", provider: "claude-bridge", baseUrl: "claude-bridge" };
const user = (content) => ({ role: "user", content, timestamp: 1 });
const assistant = (content) => ({ role: "assistant", content, provider: "claude-bridge", timestamp: 2 });
afterEach(() => __test.setQuery(null));

describe("fork behavior after upstream v0.12 sync", () => {
	it("registers only a provider, with Max as the default plan", () => {
		assert.deepEqual(registeredTools, []);
		assert.equal(provider.models.find((m) => m.id === "claude-opus-4-6").contextWindow, 1_000_000);
		assert.ok(provider.models.some((m) => m.id === "claude-fable-5-2"));
	});

	it("keeps foreign parallel tool ids bounded, valid, distinct and paired", () => {
		const ids = ["a.b", "a/b", "x".repeat(80) + "a", "x".repeat(80) + "b", ""];
		const { anthropicMessages } = convertPiMessages([
			assistant(ids.map((id) => ({ type: "toolCall", id, name: "read", arguments: {} }))),
			...ids.map((toolCallId) => ({ role: "toolResult", toolCallId, toolName: "read", content: [{ type: "text", text: "ok" }], timestamp: 3 })),
		]);
		const calls = anthropicMessages[0].content.map((b) => b.id);
		const results = anthropicMessages[1].content.map((b) => b.tool_use_id);
		assert.equal(new Set(calls).size, ids.length);
		assert.ok(calls.every((id) => id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id)));
		assert.deepEqual(results, calls);
	});

	it("can drop prefix-bound thinking during a full import without losing tool calls", () => {
		const messages = [assistant([
			{ type: "thinking", thinking: "private", thinkingSignature: "signed-prefix" },
			{ type: "toolCall", id: "X", name: "read", arguments: {} },
		])];
		assert.equal(convertPiMessages(messages).anthropicMessages[0].content[0].type, "thinking");
		assert.deepEqual(convertPiMessages(messages, undefined, undefined, true).anthropicMessages[0].content.map((b) => b.type), ["tool_use"]);
	});

	it("isolates extension-owned no-cache completions, retaining auth, private prompt and usage", async () => {
		const launches = [];
		__test.setQuery((params) => {
			launches.push(params);
			const q = (async function* () {
				yield { type: "result", subtype: "success", result: "PLANNER_OK", usage: { input_tokens: 12, output_tokens: 3 } };
			})();
			q.close = () => {};
			q.interrupt = async () => {};
			return q;
		});
		const before = __test.getSharedSession("planner-parent");
		const result = await provider.streamSimple(model, {
			systemPrompt: "Private planner prompt not captured by the chat.", messages: [user("Plan.")],
		}, { cacheRetention: "none", sessionId: "planner-parent", reasoning: "low" }).result();
		assert.equal(result.stopReason, "stop", result.errorMessage);
		assert.equal(result.content[0].text, "PLANNER_OK");
		assert.equal(result.usage.input, 12);
		assert.equal(result.usage.output, 3);
		assert.equal(launches[0].options.env.ANTHROPIC_API_KEY, "unit-test-key");
		assert.equal(launches[0].options.systemPrompt, "Private planner prompt not captured by the chat.");
		assert.equal(launches[0].options.persistSession, false);
		assert.equal(launches[0].options.effort, "low");
		assert.equal(__test.getSharedSession("planner-parent"), before);
	});

	it("merges request env without allowing inherited auth or session-storage overrides", () => {
		const resolved = { auth: { apiKey: "pi-key", baseUrl: "https://pi.invalid" }, source: "API key", env: { HTTPS_PROXY: "old", REMOVE_ME: "yes" } };
		const env = buildClaudeChildEnv({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "parent", ANTHROPIC_API_KEY: "inherited" }, resolved,
			{ HTTPS_PROXY: "new", REMOVE_ME: "", ANTHROPIC_API_KEY: "request-shadow" });
		assert.equal(env.ANTHROPIC_API_KEY, "pi-key");
		assert.equal(env.ANTHROPIC_BASE_URL, "https://pi.invalid");
		assert.equal(env.HTTPS_PROXY, "new");
		assert.equal(env.REMOVE_ME, undefined);
		assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined);
		assert.throws(() => buildClaudeChildEnv({}, resolved, { HOME: "/elsewhere" }), /provider env can't set HOME/);
	});
});
