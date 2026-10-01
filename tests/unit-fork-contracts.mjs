import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { adaptiveThinkingAlwaysOn, thinkingBoundToPrefix, minClaudeCodeVersionForModel } from "../src/models.js";
import { sharedPromptCaptures } from "../src/prompt-capture.js";

const key = Symbol.for("claude-bridge:promptCaptures");
const previous = globalThis[key];
afterEach(() => {
	if (previous === undefined) delete globalThis[key];
	else globalThis[key] = previous;
});

describe("fork contracts retained across upstream sync", () => {
	it("shares prompt captures between package roots without replacing a foreign instance", () => {
		delete globalThis[key];
		const first = sharedPromptCaptures();
		first.record("shared", { custom: "first copy", contextFiles: [], skills: [] });
		const second = sharedPromptCaptures();
		assert.equal(second, first);
		assert.equal(second.resolve("shared").custom, "first copy");

		const foreign = { resolve: () => "foreign copy" };
		globalThis[key] = foreign;
		assert.equal(sharedPromptCaptures(), foreign);
	});

	it("preserves Fable thinking and CLI compatibility policies", () => {
		for (const id of ["claude-fable-5-1", "claude-fable-5-1[1m]"]) {
			assert.equal(adaptiveThinkingAlwaysOn(id), true);
			assert.equal(thinkingBoundToPrefix(id), true);
			assert.equal(minClaudeCodeVersionForModel(id), "2.1.251");
		}
		assert.equal(adaptiveThinkingAlwaysOn("claude-fable-5"), true);
		assert.equal(thinkingBoundToPrefix("claude-fable-5"), false);
		assert.equal(adaptiveThinkingAlwaysOn("claude-opus-5-5"), false);
		assert.equal(thinkingBoundToPrefix("claude-opus-5-5"), false);
		assert.equal(minClaudeCodeVersionForModel("claude-opus-5-5"), undefined);
	});
});
