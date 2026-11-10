#!/usr/bin/env node
// Regression: extension-owned modelRegistry.complete() calls with a private
// system prompt used to enter the live bridge provider path. Prompt capture
// correctly rejected that unrecorded prompt, making verbatim compaction report
// "Planner provider returned an error." No-cache calls now use an isolated
// Claude Code subprocess and leave the resumable chat session untouched.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRpcHarness, seedPiAnthropicAuth } from "./lib/rpc-harness.mjs";

const TIMEOUT = 180_000;
const BRIDGE_MODEL = process.env.BRIDGE_TEST_MODEL ?? "claude-bridge/claude-haiku-4-5";
const testAgentDir = mkdtempSync(join(tmpdir(), "standalone-complete-agent-"));
const resultPath = join(testAgentDir, "result.json");
seedPiAnthropicAuth(testAgentDir);

const harness = createRpcHarness({
	name: "standalone-complete",
	args: [
		"-e", "./tests/fixtures/standalone-complete-extension.ts",
		"--model", BRIDGE_MODEL,
	],
	env: {
		PI_CODING_AGENT_DIR: testAgentDir,
		STANDALONE_COMPLETE_RESULT: resultPath,
	},
	defaultTimeout: TIMEOUT,
});

const { startAndWait, stop, send, promptAndWait, DEBUG_LOG, RPC_LOG } = harness;
await startAndWait();

try {
	const before = await promptAndWait('Reply with exactly "before-ok". Do not use tools.');
	if (!/before-ok/i.test(before)) throw new Error(`initial turn failed: ${before}`);

	await send({ type: "prompt", message: "/probe-standalone-complete" }, TIMEOUT);
	const nested = JSON.parse(readFileSync(resultPath, "utf8"));
	if (nested.stopReason !== "stop") {
		throw new Error(`nested completion failed: ${JSON.stringify({ stopReason: nested.stopReason, errorMessage: nested.errorMessage })}`);
	}
	const nestedText = nested.content?.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";
	if (!/STANDALONE-OK/.test(nestedText)) throw new Error(`unexpected nested output: ${nestedText}`);

	const after = await promptAndWait('Reply with exactly "after-ok". Do not use tools.');
	if (!/after-ok/i.test(after)) throw new Error(`post-standalone turn failed: ${after}`);

	const log = readFileSync(DEBUG_LOG, "utf8");
	if (!/provider: one-off summarizer call \(cacheRetention none\) routed to isolated summary/.test(log)) {
		throw new Error("debug log has no standalone routing marker");
	}
	if (/prompt-capture: no match/.test(log)) {
		throw new Error("standalone prompt reached prompt capture");
	}
	const established = log.match(/syncResult: path=clean-start sessionId=([0-9a-f-]+)/)?.[1];
	const resumed = log.match(/syncResult: path=reuse sessionId=([0-9a-f-]+)/)?.[1];
	if (!established || !resumed) {
		throw new Error(`expected an established and resumed chat session, got established=${established} resumed=${resumed}`);
	}
	if (!resumed.startsWith(established)) {
		throw new Error(`standalone call changed chat session: ${established} -> ${resumed}`);
	}
	const standaloneEnd = log.indexOf("compact summary: done");
	if (/syncResult: path=rebuild/.test(log.slice(standaloneEnd))) {
		throw new Error("post-standalone chat turn rebuilt instead of resuming");
	}

	console.log(`  model: ${BRIDGE_MODEL}`);
	console.log(`  nested: ${nestedText.trim()}`);
	console.log(`  chat session preserved: ${resumed}`);
	console.log("PASS");
} catch (error) {
	process.exitCode = 1;
	console.log(`FAIL: ${error.message}\n${error.stack}`);
	console.log(`  RPC log:   ${RPC_LOG}`);
	console.log(`  Debug log: ${DEBUG_LOG}`);
} finally {
	await stop();
	rmSync(testAgentDir, { recursive: true, force: true });
}
