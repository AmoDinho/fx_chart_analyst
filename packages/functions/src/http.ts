import { isAsset, isUtcDate } from "@fx/core/capture/config";
import { CursorError } from "./storage/cursor";

export type HttpEvent = {
	rawPath?: string;
	pathParameters?: Record<string, string | undefined> | null;
	queryStringParameters?: Record<string, string | undefined> | null;
	body?: string | null;
	requestContext?: {
		http?: { method?: string };
		authorizer?: {
			jwt?: {
				claims?: Record<string, string | undefined>;
			};
		};
	};
};

export type HttpResult = {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
};

export function json(statusCode: number, body: unknown, extra: Record<string, string> = {}): HttpResult {
	return {
		statusCode,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
			...extra,
		},
		body: JSON.stringify(body),
	};
}

export function isAdmin(event: HttpEvent): boolean {
	const groups = event.requestContext?.authorizer?.jwt?.claims?.["cognito:groups"] ?? "";
	return String(groups).includes("admins");
}

export function requireAdmin(event: HttpEvent): HttpResult | null {
	if (isAdmin(event)) return null;
	return json(403, { error: "admins group required" });
}

export function readDate(value: string | undefined): string | HttpResult {
	if (!value || !isUtcDate(value)) return json(400, { error: "bad date" });
	return value;
}

export function readAsset(value: string | undefined): "nasdaq100" | "gold" | HttpResult {
	if (!value || !isAsset(value)) return json(400, { error: "bad asset" });
	return value;
}

export function isResult(value: unknown): value is HttpResult {
	return Boolean(value && typeof value === "object" && "statusCode" in value);
}

export function parseBody(event: HttpEvent): Record<string, unknown> {
	if (!event.body) return {};
	try {
		const parsed = JSON.parse(event.body) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as Record<string, unknown>;
	} catch {
		return {};
	}
}

export function limitOf(value: string | undefined, fallback = 30): number {
	const parsed = Number(value ?? fallback);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return Math.min(100, Math.floor(parsed));
}

export function badCursor(error: unknown): HttpResult | null {
	if (error instanceof CursorError) return json(400, { error: "bad cursor" });
	return null;
}
