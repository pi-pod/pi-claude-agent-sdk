#!/usr/bin/env node
// Pins the pi-ai compatibility contract the bridge deliberately relies on when
// handing its native Pi history to another provider.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";

const target = {
	id: "foreign-model",
	name: "Foreign model",
	api: "openai-completions",
	provider: "foreign",
	baseUrl: "https://example.invalid",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
};

describe("Claude bridge → foreign provider history", () => {
	it("keeps parallel tool calls paired while removing Claude-only thinking metadata", () => {
		const ids = ["toolu_alpha", "toolu_beta", "toolu_gamma"];
		const history = [
			{ role: "user", content: [{ type: "text", text: "read three files" }], timestamp: 1 },
			{
				role: "assistant",
				api: "claude-bridge",
				provider: "claude-bridge",
				model: "claude-haiku-4-5",
				stopReason: "toolUse",
				timestamp: 2,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
				content: [
					{ type: "thinking", thinking: "Claude reasoning", thinkingSignature: "claude-signature" },
					...ids.map((id, index) => ({ type: "toolCall", id, name: "read", arguments: { path: `${index}.txt` } })),
				],
			},
			...ids.map((toolCallId, index) => ({
				role: "toolResult", toolCallId, toolName: "read", isError: false, timestamp: 3 + index,
				content: [{ type: "text", text: `value-${index}` }],
			})),
		];

		const transformed = transformMessages(history, target, (id) => id);
		const assistant = transformed.find((message) => message.role === "assistant");
		assert.equal(assistant.content.some((block) => block.type === "thinking"), false);
		assert.equal(assistant.content.some((block) => "thinkingSignature" in block), false);
		const callIds = assistant.content.filter((block) => block.type === "toolCall").map((block) => block.id);
		const resultIds = transformed.filter((message) => message.role === "toolResult").map((message) => message.toolCallId);
		assert.deepEqual(callIds, ids);
		assert.deepEqual(resultIds, ids);
	});
});
