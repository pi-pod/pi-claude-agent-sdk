import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { claudeCodeSettings, loadConfig } from "../src/config.js";

function withTempHome(fn) {
	const oldHome = process.env.HOME;
	const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
	const home = mkdtempSync(join(tmpdir(), "claude-bridge-home-"));
	try {
		process.env.HOME = home;
		process.env.PI_CODING_AGENT_DIR = join(home, "agent");
		return fn(home);
	} finally {
		if (oldHome === undefined) delete process.env.HOME;
		else process.env.HOME = oldHome;
		if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
		rmSync(home, { recursive: true, force: true });
	}
}

describe("claudeCodeSettings", () => {
	it("disables auto-memory by default", () => {
		assert.deepEqual(claudeCodeSettings(), { autoMemoryEnabled: false });
	});

	it("allows auto-memory to be enabled", () => {
		assert.deepEqual(claudeCodeSettings({ autoMemoryEnabled: true }), { autoMemoryEnabled: true });
	});
});

describe("loadConfig", () => {
	it("ignores a project config: a repo can't set provider settings", () => withTempHome(() => {
		const cwd = mkdtempSync(join(tmpdir(), "claude-bridge-project-"));
		const oldCwd = process.cwd();
		try {
			const configDir = join(cwd, CONFIG_DIR_NAME);
			mkdirSync(configDir, { recursive: true });
			writeFileSync(join(configDir, "claude-bridge.json"), JSON.stringify({
				provider: { plan: "max", pathToClaudeCodeExecutable: join(cwd, "evil") },
			}));
			process.chdir(cwd);

			assert.deepEqual(loadConfig(), { provider: {} });
		} finally {
			process.chdir(oldCwd);
			rmSync(cwd, { recursive: true, force: true });
		}
	}));

	it("resolves global config via PI_CODING_AGENT_DIR override, not hardcoded ~/.pi/agent", () => withTempHome(() => {
		const agentDir = mkdtempSync(join(tmpdir(), "claude-bridge-agent-"));
		const oldEnv = process.env.PI_CODING_AGENT_DIR;
		try {
			process.env.PI_CODING_AGENT_DIR = agentDir;
			writeFileSync(join(agentDir, "claude-bridge.json"), JSON.stringify({
				provider: { plan: "max" },
			}));

			assert.deepEqual(loadConfig(), { provider: { plan: "max" } });
		} finally {
			if (oldEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = oldEnv;
			rmSync(agentDir, { recursive: true, force: true });
		}
	}));
});

describe("provider-only config", () => {
	it("ignores removed AskClaude settings", () => withTempHome(() => {
		mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
		writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "claude-bridge.json"), JSON.stringify({ askClaude: { enabled: true } }));
		assert.deepEqual(loadConfig(), { provider: {} });
	}));
});
