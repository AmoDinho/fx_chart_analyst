import type { Asset } from "@fx/core/capture/config";

export type CaptureInput = {
	asset: string;
	date: string;
	timeframes: string[];
	force: boolean;
	store: boolean;
	id?: string;
};

export type StoredFrame = {
	timeframe: string;
	key: string;
	hash: string;
	width: number;
	height: number;
	verified: boolean;
};

export type CaptureOutput = {
	stored: StoredFrame[];
	notes: string[];
	quality: "ok" | "poor";
	fatal?: string;
	durationMs: number;
};

export type DraftRecord = {
	content: string;
	finishReason: string | null;
	usage: {
		prompt_tokens: number | null;
		completion_tokens: number | null;
		prompt_cache_hit_tokens: number | null;
		prompt_cache_miss_tokens: number | null;
	};
};

export type AlertKind = "failure" | "poor-capture" | "grounding";

export type AlertPayload = {
	kind: AlertKind;
	asset: string;
	date: string;
	message: string;
	runId: string;
};

export type DispatchSource = "cron" | "admin";

export type DispatchRequest = {
	source: DispatchSource;
	phase: "full" | "analyse";
	date?: string;
	asset?: Asset;
	force?: boolean;
	now?: number;
};
