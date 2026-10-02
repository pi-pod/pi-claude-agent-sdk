import type { AuthResult } from "@earendil-works/pi-ai";

// Applied to every Claude Code subprocess the bridge spawns. Pi owns both its
// tool surface and context compaction, so Claude Code must not add either one.
export const CC_CHILD_ENV = {
	ENABLE_CLAUDEAI_MCP_SERVERS: "0",
	DISABLE_AUTO_COMPACT: "1",
} as const;

export interface AnthropicAuthRegistry {
	getProviderAuth(provider: string): Promise<AuthResult | undefined>;
}

/** Build an isolated child environment from Pi's resolved Anthropic auth.
 *
 * Pi refreshes stored OAuth before getProviderAuth() resolves. Claude Code's
 * supported OAuth injection point is CLAUDE_CODE_OAUTH_TOKEN; API keys keep
 * using ANTHROPIC_API_KEY. All inherited Claude/Anthropic auth and alternate
 * backend settings are removed so every child relies exclusively on the
 * credential and endpoint resolved by Pi.
 */
export function buildClaudeChildEnv(
	base: NodeJS.ProcessEnv,
	resolved?: AuthResult,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...base, ...(resolved?.env ?? {}), ...CC_CHILD_ENV };
	for (const key of [
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_AUTH_TOKEN",
		"ANTHROPIC_OAUTH_TOKEN",
		"ANTHROPIC_IDENTITY_TOKEN",
		"ANTHROPIC_IDENTITY_TOKEN_FILE",
		"ANTHROPIC_BASE_URL",
		"ANTHROPIC_CUSTOM_HEADERS",
		"CLAUDE_CODE_OAUTH_TOKEN",
		"CLAUDE_CODE_CUSTOM_OAUTH_URL",
		"CLAUDE_CODE_OAUTH_CLIENT_ID",
		"CLAUDE_CODE_USE_BEDROCK",
		"CLAUDE_CODE_USE_FOUNDRY",
		"CLAUDE_CODE_USE_VERTEX",
	] as const) delete env[key];

	const headers = Object.entries(resolved?.auth.headers ?? {}).filter((entry): entry is [string, string] => entry[1] != null);
	const authorization = headers.find(([name]) => name.toLowerCase() === "authorization")?.[1];
	const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
	const headerApiKey = headers.find(([name]) => name.toLowerCase() === "x-api-key")?.[1];
	const credential = resolved?.auth.apiKey ?? headerApiKey;
	if (!credential && !bearerToken) {
		throw new Error("No Anthropic credential is configured in Pi. Configure Anthropic authentication in Pi before using claude-bridge.");
	}

	if (resolved?.auth.baseUrl) env.ANTHROPIC_BASE_URL = resolved.auth.baseUrl;
	const customHeaders = headers.filter(([name]) => !["authorization", "x-api-key"].includes(name.toLowerCase()));
	if (customHeaders.length > 0) {
		env.ANTHROPIC_CUSTOM_HEADERS = customHeaders.map(([name, value]) => `${name}: ${value}`).join("\n");
	}

	if (bearerToken) {
		env.ANTHROPIC_AUTH_TOKEN = bearerToken;
	} else if (resolved?.source?.toLowerCase().includes("oauth")) {
		env.CLAUDE_CODE_OAUTH_TOKEN = credential;
	} else {
		env.ANTHROPIC_API_KEY = credential;
	}
	return env;
}

/** Remaining validity an OAuth token must have before it is handed to a child.
 *
 * A child keeps the token it was spawned with for its whole turn and cannot
 * refresh it (it never sees the refresh token), so a turn that outlives the
 * token fails with "401 OAuth access token has expired". Pi's default refresh
 * window is five minutes; asking for more refreshes early instead. Anthropic
 * access tokens last about eight hours, so this costs one extra refresh per
 * cycle and leaves only turns longer than this exposed.
 */
export const CHILD_OAUTH_MIN_VALIDITY_MS = 2 * 60 * 60 * 1000;

interface AnthropicAuthRuntime {
	getAuth(provider: string, overrides?: { minOAuthValidityMs?: number }): Promise<AuthResult | undefined>;
}

// Latched when the provider issues tokens shorter than the minimum: pi refreshes
// and then rejects the result, so retrying would refresh on every child spawn.
let minValidityUnsatisfiable = false;

/** Pi's public getProviderAuth() takes no overrides, but is a pass-through to
 * ModelRuntime.getAuth(), which accepts minOAuthValidityMs. Reach the runtime
 * when it is there and fall back to the public call otherwise. */
async function resolveAnthropicAuth(registry: AnthropicAuthRegistry): Promise<AuthResult | undefined> {
	const runtime = (registry as { runtime?: Partial<AnthropicAuthRuntime> }).runtime;
	if (!minValidityUnsatisfiable && typeof runtime?.getAuth === "function") {
		try {
			return await runtime.getAuth("anthropic", { minOAuthValidityMs: CHILD_OAUTH_MIN_VALIDITY_MS });
		} catch (err) {
			if (/expires too soon/i.test(err instanceof Error ? err.message : String(err))) minValidityUnsatisfiable = true;
		}
	}
	return registry.getProviderAuth("anthropic");
}

export async function resolveClaudeChildEnv(
	registry: AnthropicAuthRegistry | null | undefined,
	base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
	const resolved = registry ? await resolveAnthropicAuth(registry) : undefined;
	return buildClaudeChildEnv(base, resolved);
}

/** Test hook: clear the unsatisfiable-minimum latch. */
export function resetChildAuthState(): void {
	minValidityUnsatisfiable = false;
}
