// Canonical selection + display order for the model picker.
// `resolveModel` returns the first partial match, so `opus` resolves to the first-listed opus entry.
// Extracted from index.ts so tests can import without activating the extension.

export const MODEL_IDS_IN_ORDER = ["claude-fable-5-1", "claude-fable-5", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"];

const TWO_HUNDRED_K_CONTEXT = 200_000;
const ONE_M_CONTEXT = 1_000_000;

/** Catalog stubs for IDs Claude Code already serves that the installed pi-ai has
 *  not listed yet. Prefer pi-ai when it has the entry. Fable 5.1 shipped
 *  2026-09-01; pi-ai 0.84.4 (2026-08-28) does not include it. */
export const FALLBACK_MODELS: Record<string, {
	id: string;
	name: string;
	reasoning: boolean;
	input: string[];
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Record<string, string | null>;
}> = {
	"claude-opus-5-5": {
		id: "claude-opus-5-5",
		name: "Claude Opus 5.5",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: ONE_M_CONTEXT,
		maxTokens: 128_000,
		// Matches pi-ai's claude-opus-5-5: adaptive thinking, no off/minimal.
		thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
	},
	"claude-fable-5-1": {
		id: "claude-fable-5-1",
		name: "Claude Fable 5.1",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: ONE_M_CONTEXT,
		maxTokens: 128_000,
		// Same shape as pi-ai's claude-fable-5: adaptive thinking, xhigh visible.
		thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
	},
};

// Project pi-ai's model entries down to the fields pi's registerProvider expects,
// and keep MODEL_IDS_IN_ORDER ordering. IDs missing from pi-ai are silently dropped
// unless FALLBACK_MODELS has a stub. Context-dependent display labels are applied
// after plan/long-context config is known.
export function buildModels<T extends { id: string; [key: string]: any }>(piAiModels: T[]) {
	return MODEL_IDS_IN_ORDER
		.map((id) => piAiModels.find((m) => m.id === id) ?? FALLBACK_MODELS[id])
		.filter((m) => m != null)
		// Forward thinkingLevelMap so pi-ai's per-model overrides (e.g. opus-4-8
		// mapping xhigh→xhigh and max→max) are visible to the effort lookup.
		.map(({ id, name, reasoning, input, contextWindow, maxTokens, thinkingLevelMap }) => ({
			id,
			name,
			reasoning, input, contextWindow, maxTokens,
			thinkingLevelMap,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}));
}

export type LongContextSettings = {
	plan: "pro" | "max";
	longContextExtraUsage: boolean;
};

export type ClaudeCodeRuntimeModel = {
	cliModelId: string;
	contextWindow: number;
};

// Measured Claude Agent SDK subscription/OAuth behavior. Do not infer this from
// pi-ai's advertised contextWindow: bare Opus 4.7 serves 1M, bare Opus 4.8 does
// not, and [1m] entitlement differs by model. See diag/CONTEXT-SIZE.md.
export function resolveClaudeCodeRuntimeModel(modelId: string, settings: LongContextSettings): ClaudeCodeRuntimeModel {
	switch (modelId) {
		case "claude-opus-5-5":
			// 1M is the default and the maximum, billed at standard rates across the whole
			// window (no Extra Usage). CC still takes the [1m] suffix to request that window.
			return { cliModelId: "claude-opus-5-5[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-opus-5":
			return { cliModelId: "claude-opus-5[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-opus-4-8":
			return { cliModelId: "claude-opus-4-8[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-opus-4-7":
			return { cliModelId: "claude-opus-4-7", contextWindow: ONE_M_CONTEXT };
		case "claude-opus-4-6": {
			const useOneM = settings.plan === "max" || settings.longContextExtraUsage;
			return {
				cliModelId: useOneM ? "claude-opus-4-6[1m]" : "claude-opus-4-6",
				contextWindow: useOneM ? ONE_M_CONTEXT : TWO_HUNDRED_K_CONTEXT,
			};
		}
		case "claude-fable-5-1":
			// 1M is the default and the maximum, billed at standard rates across the
			// whole window (no Extra Usage). CC still takes the [1m] suffix to request
			// that window, same as Fable 5 / Opus 5.
			return { cliModelId: "claude-fable-5-1[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-fable-5":
			return { cliModelId: "claude-fable-5[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-sonnet-5":
			return { cliModelId: "claude-sonnet-5[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-sonnet-4-6":
			return {
				cliModelId: settings.longContextExtraUsage ? "claude-sonnet-4-6[1m]" : "claude-sonnet-4-6",
				contextWindow: settings.longContextExtraUsage ? ONE_M_CONTEXT : TWO_HUNDRED_K_CONTEXT,
			};
		case "claude-haiku-4-5":
			return { cliModelId: "claude-haiku-4-5", contextWindow: TWO_HUNDRED_K_CONTEXT };
		default:
			console.error(`claude-bridge: encountered model ${modelId} with no known context size, defaulting to 200K`);
			return { cliModelId: modelId, contextWindow: TWO_HUNDRED_K_CONTEXT };
	}
}

export function claudeCodeModelId(model: { id: string }, settings: LongContextSettings): string {
	return resolveClaudeCodeRuntimeModel(model.id, settings).cliModelId;
}

/** Adaptive thinking is always on. `thinking: enabled` with budget_tokens and
 *  `disabled` both 400; omit thinking or send adaptive. `thinking.display`
 *  defaults to omitted, so the stream has no thinking text unless we ask. */
export function adaptiveThinkingAlwaysOn(modelId: string): boolean {
	return modelId === "claude-fable-5-1" || modelId.startsWith("claude-fable-5-1[")
		|| modelId === "claude-fable-5" || modelId.startsWith("claude-fable-5[");
}

/** Fable 5.1 binds each thinking block to the conversation prefix. Replaying a
 *  block after a rebuild (new system prompt or tools) 400s with "The block is
 *  bound to a different conversation". Resume is fine; rebuilds must drop
 *  thinking. https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1#editing-earlier-turns-invalidates-thinking-blocks */
export function thinkingBoundToPrefix(modelId: string): boolean {
	return modelId === "claude-fable-5-1" || modelId.startsWith("claude-fable-5-1[");
}

/** Minimum Claude Code CLI version that will accept this model. Undefined
 *  means the SDK's bundled CLI is fine. Fable 5.1 400s on 2.1.141 with
 *  "version 2.1.251 or newer is required". */
export function minClaudeCodeVersionForModel(modelId: string): string | undefined {
	if (modelId === "claude-fable-5-1" || modelId.startsWith("claude-fable-5-1[")) return "2.1.251";
	return undefined;
}

export function resolveModel<T extends { id: string }>(models: T[], input: string): T | undefined {
	const lower = input.toLowerCase();
	// Exact match first: otherwise `claude-fable-5` would hit `claude-fable-5-1`
	// via includes() when the newer id is listed first for the `fable` shortcut.
	return models.find((m) => m.id === lower) ?? models.find((m) => m.id.includes(lower));
}

// Produce the model metadata registered with pi. The registered contextWindow must
// match the window the bridge actually requests from Claude Code, or pi's status
// bar and auto-compaction threshold will misreport. The runtime policy is based
// on measured SDK behavior - see diag/CONTEXT-SIZE.md
export function applyLongContext<T extends { id: string; name: string; contextWindow?: number | null }>(
	models: T[],
	settings: LongContextSettings,
): T[] {
	return models.map((m) => {
		const { contextWindow } = resolveClaudeCodeRuntimeModel(m.id, settings);
		const name = contextWindow > TWO_HUNDRED_K_CONTEXT && !/\b1M\b/i.test(m.name) ? `${m.name} 1M` : m.name;
		return contextWindow === m.contextWindow && name === m.name ? m : { ...m, contextWindow, name };
	});
}
