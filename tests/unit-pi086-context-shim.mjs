/**
 * Regression tests for shimPi086Context, which undoes pi 0.86's normalizeContext().
 *
 * The expected values here are not guesses about pi's internals: they reproduce
 * pi's own accessors (getCurrentTools / getCurrentSystemMessage /
 * getSystemMessageText in pi's bundled chunk), which is what the shim has to
 * match byte for byte. A reconstructed prompt that is merely close is worse than
 * none at all — promptCaptures.resolveOrDerive throws on a prompt it cannot
 * account for, so a drifting reconstruction turns a working turn into a failed
 * one.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { __test } = await import("../src/index.js");

const tool = (name) => ({ name, description: `${name} tool`, parameters: { type: "object" } });

describe("shimPi086Context", () => {
	it("unfolds pi 0.86's leading system message into systemPrompt and tools", () => {
		const context = {
			messages: [
				{
					role: "system",
					content: "",
					sections: { preamble: "You are an assistant.", rules: "<rules>\nBe brief.\n</rules>" },
					timestamp: 0,
					toolsAdded: [tool("read"), tool("bash")],
				},
				{ role: "user", content: "hi" },
			],
		};

		const shimmed = __test.shimPi086Context(context);

		// getSystemMessageText: [content, ...section values], empties dropped, "\n\n".
		assert.equal(shimmed.systemPrompt, "You are an assistant.\n\n<rules>\nBe brief.\n</rules>");
		assert.deepEqual(shimmed.tools.map((t) => t.name), ["read", "bash"]);
		// The system message must not reach convertPiMessages: it has no branch for
		// the role, so a first turn would rebuild a session with zero records, and
		// Session.save() writes no file for an empty record set. The turn then
		// resumes a session id that is not on disk ("No conversation found").
		assert.deepEqual(shimmed.messages, [{ role: "user", content: "hi" }]);
	});

	it("keeps a non-empty content block ahead of the sections", () => {
		const shimmed = __test.shimPi086Context({
			messages: [
				{ role: "system", content: "Custom prompt.", sections: { cwd: "cwd: /tmp" }, toolsAdded: [tool("read")] },
				{ role: "user", content: "hi" },
			],
		});

		assert.equal(shimmed.systemPrompt, "Custom prompt.\n\ncwd: /tmp");
	});

	it("merges sections across system messages, with null deleting one", () => {
		const shimmed = __test.shimPi086Context({
			messages: [
				{ role: "system", content: "", sections: { preamble: "first", docs: "drop me" }, toolsAdded: [tool("read")] },
				{ role: "user", content: "hi" },
				{ role: "assistant", content: [{ type: "text", text: "ok" }] },
				// A mid-conversation system update: replaces one section, removes another.
				{ role: "system", content: "", sections: { preamble: "second", docs: null } },
				{ role: "user", content: "again" },
			],
		});

		// Replaced in place — key order follows first insertion, as pi's Map does.
		assert.equal(shimmed.systemPrompt, "second");
		assert.equal(shimmed.messages.length, 3);
		assert.ok(shimmed.messages.every((m) => m.role !== "system"));
	});

	it("replays toolsAdded and toolsRemoved in message order", () => {
		const shimmed = __test.shimPi086Context({
			messages: [
				{ role: "system", content: "p", toolsAdded: [tool("read"), tool("bash"), tool("edit")] },
				{ role: "user", content: "hi" },
				{ role: "system", content: "", toolsRemoved: [tool("bash")], toolsAdded: [tool("write")] },
				{ role: "user", content: "again" },
			],
		});

		assert.deepEqual(shimmed.tools.map((t) => t.name), ["read", "edit", "write"]);
	});

	it("leaves tools undefined when no tool is registered", () => {
		// isStandaloneRequest keys on tools === undefined to route pi's no-cache
		// summary and extension completions. Handing it an empty array would send
		// them down the resumable provider path and let an unrelated summarizer
		// take over the interactive agent's Claude Code session.
		const shimmed = __test.shimPi086Context({
			messages: [
				{ role: "system", content: "Summarize the following.", timestamp: 0 },
				{ role: "user", content: "transcript" },
			],
		});

		assert.equal(shimmed.tools, undefined);
		assert.equal(shimmed.systemPrompt, "Summarize the following.");
		assert.equal(shimmed.messages.length, 1);
	});

	it("is a no-op on the pre-0.86 contract", () => {
		// Same object identity, not merely equal: the shim must not allocate or
		// reorder anything on a pi that still populates these fields.
		const context = { systemPrompt: "already here", tools: [tool("read")], messages: [{ role: "user", content: "hi" }] };
		assert.equal(__test.shimPi086Context(context), context);
	});

	it("is a no-op when tools are present but the prompt is empty", () => {
		const context = { tools: [tool("read")], messages: [{ role: "user", content: "hi" }] };
		assert.equal(__test.shimPi086Context(context), context);
	});

	it("is a no-op when there is no system message to unfold", () => {
		const context = { messages: [{ role: "user", content: "hi" }] };
		assert.equal(__test.shimPi086Context(context), context);
	});
});
