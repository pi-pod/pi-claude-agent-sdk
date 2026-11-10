/**
 * Unit-suite preload: isolate tests from the developer's real HOME/pi/claude state.
 *
 * Must run before test files import src modules — src/log-paths.ts resolves
 * paths lazily now, but keep the preload so tests never touch real HOME state
 * even when they forget to swap env themselves.
 *
 * Wiring this as `node --import ./tests/lib/setup.mjs` guarantees it runs first
 * in every test child process. tests/unit-debug-path.mjs asserts it took effect.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "claude-bridge-test-log-"));
process.env.HOME = root;
process.env.USERPROFILE = root;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
process.env.CLAUDE_BRIDGE_DEBUG_PATH = join(root, "claude-bridge.log");
process.env.CLAUDE_BRIDGE_DEBUG = "1";
delete process.env.CLAUDE_BRIDGE_RECORD_STREAM;
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "unit-test-key" } }), { mode: 0o600 });

// Unit queries use stubbed SDK iterators, never the developer's real credential.
const { __test } = await import("../../src/index.js");
__test.setPiModelRegistry({
	async getProviderAuth() { return { auth: { apiKey: "unit-test-key" }, source: "API key" }; },
});
