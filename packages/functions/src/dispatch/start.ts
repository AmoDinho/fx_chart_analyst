import { ASSETS } from "@fx/core/api";
import { isAsset, isUtcDate, utcDate, type Asset } from "@fx/core/capture/config";
import { executionName, normalizeParams, type DailyParams, type DailyPhase } from "@fx/core/workflow-params";
import type { DispatchRequest } from "../contracts";

export type DispatchPlan = {
	executionName: string;
	payload: DailyParams;
};

export function planDispatch(input: DispatchRequest): DispatchPlan {
	const now = input.now ?? Date.now();
	const date = input.source === "cron" ? utcDate(new Date(now)) : input.date ?? utcDate(new Date(now));
	if (!isUtcDate(date)) throw new Error("workflow date invalid");
	const assets = resolveAssets(input);
	const phase: DailyPhase = input.phase;
	const force = input.source === "cron" ? false : input.force === true;
	const name = executionName({ date, force, phase, assets, now });
	const payload = normalizeParams({
		date,
		force,
		assets,
		phase,
		runId: name,
	});
	return { executionName: name, payload };
}

export function parseDispatchEvent(event: unknown, now = Date.now()): DispatchRequest {
	const row = unwrap(event);
	if (isCronEvent(row)) {
		return { source: "cron", phase: "full", now };
	}
	const phase = row?.phase === "analyse" ? "analyse" : "full";
	const asset = typeof row?.asset === "string" && isAsset(row.asset) ? row.asset : undefined;
	const date = typeof row?.date === "string" ? row.date : undefined;
	return {
		source: "admin",
		phase,
		date,
		asset,
		force: row?.force === true,
		now,
	};
}

export function isAlreadyStarted(error: unknown): boolean {
	const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
	const message = error instanceof Error ? error.message : String(error ?? "");
	return /already exists|Conflict|ExecutionAlreadyExists|ResourceConflict/i.test(`${name} ${message}`);
}

function resolveAssets(input: DispatchRequest): Asset[] {
	if (input.asset) return [input.asset];
	return [...ASSETS];
}

function isCronEvent(row: Record<string, unknown> | null): boolean {
	if (!row) return true;
	if (row.source === "cron" || row.source === "aws.scheduler") return true;
	if (row["detail-type"] === "Scheduled Event") return true;
	if (row.phase || row.asset || row.date || row.force === true) return false;
	return row.source == null && row.phase == null;
}

function unwrap(event: unknown): Record<string, unknown> | null {
	if (!event || typeof event !== "object") return null;
	const row = event as Record<string, unknown>;
	if (typeof row.body === "string") {
		try {
			return JSON.parse(row.body) as Record<string, unknown>;
		} catch {
			return null;
		}
	}
	return row;
}
