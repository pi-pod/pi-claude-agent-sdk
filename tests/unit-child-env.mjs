/**
 * Every Claude Code subprocess the bridge spawns has to be told to keep its hands
 * off state pi owns. These are silent when missing: CC compacts or writes memory
 * on its own, nothing throws, and the damage shows up in the user's ~/.claude
 * rather than in a test.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

const { CC_CHILD_ENV, CHILD_OAUTH_MIN_VALIDITY_MS, buildClaudeChildEnv, resolveClaudeChildEnv, resetChildAuthState } =
	await import("../src/child-env.js");

describe("Claude Code child environment", () => {
	it("disables auto-compaction and claude.ai MCP servers", () => {
		assert.deepEqual(CC_CHILD_ENV, {
			ENABLE_CLAUDEAI_MCP_SERVERS: "0",
			DISABLE_AUTO_COMPACT: "1",
		});
	});

	it("injects Pi OAuth through Claude Code's supported token variable", () => {
		const env = buildClaudeChildEnv(
			{
				ANTHROPIC_API_KEY: "inherited-key",
				ANTHROPIC_AUTH_TOKEN: "inherited-token",
				ANTHROPIC_BASE_URL: "https://inherited.invalid",
				ANTHROPIC_CUSTOM_HEADERS: "authorization: inherited",
				CLAUDE_CODE_USE_BEDROCK: "1",
			},
			{ auth: { apiKey: "pi-oauth" }, source: "OAuth" },
		);
		assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "pi-oauth");
		assert.equal(env.ANTHROPIC_API_KEY, undefined);
		assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
		assert.equal(env.ANTHROPIC_BASE_URL, undefined);
		assert.equal(env.ANTHROPIC_CUSTOM_HEADERS, undefined);
		assert.equal(env.CLAUDE_CODE_USE_BEDROCK, undefined);
	});

	it("injects Pi API keys without leaving an inherited OAuth override", () => {
		const env = buildClaudeChildEnv(
			{ CLAUDE_CODE_OAUTH_TOKEN: "inherited-oauth", ANTHROPIC_BASE_URL: "https://inherited.invalid" },
			{
				auth: { apiKey: "pi-api-key", baseUrl: "https://pi-anthropic.invalid" },
				source: "ANTHROPIC_API_KEY",
			},
		);
		assert.equal(env.ANTHROPIC_API_KEY, "pi-api-key");
		assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
		assert.equal(env.ANTHROPIC_BASE_URL, "https://pi-anthropic.invalid");
	});

	it("routes Pi OAuth env credentials through Claude Code OAuth", () => {
		const env = buildClaudeChildEnv({}, {
			auth: { apiKey: "pi-oauth-env" },
			source: "ANTHROPIC_OAUTH_TOKEN",
		});
		assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "pi-oauth-env");
		assert.equal(env.ANTHROPIC_API_KEY, undefined);
	});

	it("forwards Pi-resolved bearer auth and provider environment", () => {
		const env = buildClaudeChildEnv(
			{ ANTHROPIC_AUTH_TOKEN: "inherited-bearer" },
			{
				auth: { headers: { Authorization: "Bearer pi-bearer", "x-pi-header": "value" } },
				env: { PI_AUTH_CONTEXT: "resolved", ANTHROPIC_API_KEY: "ignored-shadow" },
				source: "ANTHROPIC_AUTH_TOKEN",
			},
		);
		assert.equal(env.ANTHROPIC_AUTH_TOKEN, "pi-bearer");
		assert.equal(env.ANTHROPIC_API_KEY, undefined);
		assert.equal(env.ANTHROPIC_CUSTOM_HEADERS, "x-pi-header: value");
		assert.equal(env.PI_AUTH_CONTEXT, "resolved");
	});

	it("rejects inherited Claude Code auth when Pi has no Anthropic credential", () => {
		assert.throws(
			() => buildClaudeChildEnv({ CLAUDE_CODE_OAUTH_TOKEN: "cc-login" }),
			/No Anthropic credential is configured in Pi/,
		);
	});

	it("resolves the Anthropic credential through Pi for every child", async () => {
		const calls = [];
		const registry = {
			async getProviderAuth(provider) {
				calls.push(provider);
				return { auth: { apiKey: "fresh-token" }, source: "OAuth" };
			},
		};
		const env = await resolveClaudeChildEnv(registry, {});
		assert.deepEqual(calls, ["anthropic"]);
		assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "fresh-token");
	});

	it("requires a Pi model registry and resolved Anthropic credential", async () => {
		await assert.rejects(resolveClaudeChildEnv(null, { CLAUDE_CODE_OAUTH_TOKEN: "cc-login" }), /No Anthropic credential/);
		await assert.rejects(
			resolveClaudeChildEnv({ async getProviderAuth() { return undefined; } }, {}),
			/No Anthropic credential/,
		);
	});

	// Deliberately not asserted here: that every `query()` call site awaits the
	// helper. Grepping source would fail on innocent indirection and read as
	// coverage; the integration auth test exercises the actual child process.
});

/**
 * A child keeps the OAuth token it was spawned with for its whole turn and can't
 * refresh it, so a token handed over with minutes left fails the turn with
 * "401 OAuth access token has expired". The bridge asks pi for a longer minimum
 * through ModelRuntime.getAuth, which pi's public getProviderAuth doesn't expose.
 */
describe("OAuth validity for Claude Code children", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
		resetChildAuthState();
	});

	async function realRegistry(expiresInMs) {
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("anthropic", async () => ({
			type: "oauth", access: "stale-access", refresh: "refresh-token", expires: Date.now() + expiresInMs,
		}));
		const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
		return { registry: new ModelRegistry(runtime), credentials };
	}

	function stubTokenEndpoint(expiresInSeconds) {
		const requests = [];
		globalThis.fetch = async (url, init) => {
			requests.push({ url: String(url), body: JSON.parse(init.body) });
			return new Response(JSON.stringify({
				access_token: "fresh-access", refresh_token: "rotated-refresh", expires_in: expiresInSeconds,
			}), { status: 200 });
		};
		return requests;
	}

	// Pins the private seam against the installed pi: if ModelRegistry stops
	// holding `runtime` or getAuth drops minOAuthValidityMs, this fails rather
	// than the bridge silently reverting to pi's five-minute window.
	it("refreshes through pi a token pi itself would still hand out", async () => {
		const { registry, credentials } = await realRegistry(60 * 60 * 1000);
		const requests = stubTokenEndpoint(8 * 60 * 60);
		assert.equal((await registry.getProviderAuth("anthropic")).auth.apiKey, "stale-access", "pi's default window keeps a one-hour token");
		assert.equal(requests.length, 0);

		const env = await resolveClaudeChildEnv(registry, {});
		assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "fresh-access");
		assert.equal(requests.length, 1);
		assert.equal(requests[0].body.grant_type, "refresh_token");
		assert.equal((await credentials.read("anthropic")).refresh, "rotated-refresh", "the rotated credential is persisted");
	});

	it("leaves a token with more than the minimum alone", async () => {
		const { registry } = await realRegistry(CHILD_OAUTH_MIN_VALIDITY_MS + 60 * 60 * 1000);
		const requests = stubTokenEndpoint(8 * 60 * 60);
		const env = await resolveClaudeChildEnv(registry, {});
		assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "stale-access");
		assert.equal(requests.length, 0);
	});

	it("stops asking for the minimum once the provider can't meet it", async () => {
		const { registry } = await realRegistry(60 * 60 * 1000);
		// One-hour tokens: every refresh comes back short of a two-hour minimum.
		const requests = stubTokenEndpoint(60 * 60);
		assert.equal((await resolveClaudeChildEnv(registry, {})).CLAUDE_CODE_OAUTH_TOKEN, "fresh-access");
		assert.equal(requests.length, 1);
		await resolveClaudeChildEnv(registry, {});
		await resolveClaudeChildEnv(registry, {});
		assert.equal(requests.length, 1, "no refresh per spawn");
	});

	it("falls back to getProviderAuth when the runtime call fails or is absent", async () => {
		const fallback = { async getProviderAuth() { return { auth: { apiKey: "public-token" }, source: "OAuth" }; } };
		assert.equal((await resolveClaudeChildEnv(fallback, {})).CLAUDE_CODE_OAUTH_TOKEN, "public-token");

		const overrides = [];
		const failing = {
			...fallback,
			runtime: { async getAuth(_provider, o) { overrides.push(o); throw new Error("OAuth refresh failed for anthropic"); } },
		};
		assert.equal((await resolveClaudeChildEnv(failing, {})).CLAUDE_CODE_OAUTH_TOKEN, "public-token");
		await resolveClaudeChildEnv(failing, {});
		assert.deepEqual(overrides, [
			{ minOAuthValidityMs: CHILD_OAUTH_MIN_VALIDITY_MS },
			{ minOAuthValidityMs: CHILD_OAUTH_MIN_VALIDITY_MS },
		], "a transient refresh failure doesn't disable the minimum");
	});
});
