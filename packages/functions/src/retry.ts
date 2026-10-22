import { AnalysisRequestError } from "@fx/core/analysis/client";

export class NonRetryableError extends Error {
	readonly retryable = false;

	constructor(message: string) {
		super(message);
		this.name = "NonRetryableError";
	}
}

export type RetryDecision = {
	shouldRetry: boolean;
	delay?: { seconds: number };
};

export function isNonRetryable(error: unknown): boolean {
	if (error instanceof NonRetryableError) return true;
	if (error instanceof AnalysisRequestError && !error.retryable) return true;
	const name = error instanceof Error ? error.name : "";
	return name === "NonRetryableError";
}

/** attempt is 1-based in the durable SDK examples (`attempt < max`). */
export function exponentialRetry(maxRetries: number, initialSeconds: number) {
	return (error: unknown, attempt: number): RetryDecision => {
		if (isNonRetryable(error)) return { shouldRetry: false };
		if (attempt > maxRetries) return { shouldRetry: false };
		const exponent = Math.max(0, attempt - 1);
		return { shouldRetry: true, delay: { seconds: initialSeconds * 2 ** exponent } };
	};
}

export function noRetry(): RetryDecision {
	return { shouldRetry: false };
}

export function chatRetry(error: unknown, attempt: number): RetryDecision {
	if (!(error instanceof AnalysisRequestError) || !error.retryable) return { shouldRetry: false };
	if (attempt > 1) return { shouldRetry: false };
	return { shouldRetry: true, delay: { seconds: 30 } };
}
