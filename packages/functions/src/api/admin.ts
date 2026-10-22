import { adminRunBodySchema, adminStartResponseSchema, screenshotBodySchema, screenshotReadySchema, screenshotStartSchema, statusResponseSchema } from "@fx/core/api";
import { isUtcDate, utcDate } from "@fx/core/capture/config";
import { DAILY_TIMEFRAMES } from "@fx/core/capture/config";
import { tempScreenshotKey } from "@fx/core/storage/keys";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { HttpEvent } from "../http";
import { json, parseBody, requireAdmin } from "../http";
import { dispatchResources, storageResources, workflowResources } from "../resources";
import { S3ObjectStore } from "../storage/s3";
import { invokeJson } from "../dispatch/invoke";

export async function run(event: HttpEvent) {
	return start(event, "full");
}

export async function analyse(event: HttpEvent) {
	return start(event, "analyse");
}

async function start(event: HttpEvent, phase: "full" | "analyse") {
	const denied = requireAdmin(event);
	if (denied) return denied;
	const parsed = adminRunBodySchema.safeParse(parseBody(event));
	if (!parsed.success) return json(400, { error: "bad body" });
	if (parsed.data.date && !isUtcDate(parsed.data.date)) return json(400, { error: "bad date" });
	const resources = await dispatchResources();
	const response = await invokeJson<{ executionName: string; created: boolean }>(
		resources.dispatchFunctionName,
		{
			source: "admin",
			phase,
			date: parsed.data.date,
			asset: parsed.data.asset,
			force: parsed.data.force,
		},
		"RequestResponse",
	);
	if (!response?.executionName) return json(502, { error: "dispatch failed" });
	return json(202, adminStartResponseSchema.parse(response));
}

export async function screenshot(event: HttpEvent) {
	const denied = requireAdmin(event);
	if (denied) return denied;
	const parsed = screenshotBodySchema.safeParse(parseBody(event));
	if (!parsed.success) return json(400, { error: "bad body" });
	if (!DAILY_TIMEFRAMES.includes(parsed.data.timeframe as (typeof DAILY_TIMEFRAMES)[number])) {
		return json(400, { error: "bad timeframe" });
	}
	const id = crypto.randomUUID();
	const resources = await workflowResources();
	const client = new LambdaClient({});
	await client.send(
		new InvokeCommand({
			FunctionName: resources.captureFunctionName,
			InvocationType: "Event",
			Payload: Buffer.from(
				JSON.stringify({
					asset: parsed.data.asset,
					date: utcDate(),
					timeframes: [parsed.data.timeframe],
					force: true,
					store: false,
					id,
				}),
			),
		}),
	);
	return json(202, screenshotStartSchema.parse({ id }));
}

export async function screenshotGet(event: HttpEvent) {
	const denied = requireAdmin(event);
	if (denied) return denied;
	const id = event.pathParameters?.id;
	if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "bad id" });
	const resources = await storageResources();
	const objects = new S3ObjectStore(resources.bucket);
	const head = await objects.head(tempScreenshotKey(id));
	if (!head) return json(200, screenshotReadySchema.parse({ id, ready: false }));
	const url = await objects.presignGet(tempScreenshotKey(id));
	return json(200, screenshotReadySchema.parse({ id, ready: true, url }));
}

export async function status(event: HttpEvent) {
	const denied = requireAdmin(event);
	if (denied) return denied;
	const resources = await workflowResources();
	const executions = await listExecutions(resources.workflowName, resources.workflowQualifier);
	return json(200, statusResponseSchema.parse({ executions }));
}

export async function listExecutions(name: string, qualifier?: string) {
	const { workflow } = await import("sst/aws/workflow");
	const listed = await workflow.list({ name, qualifier: qualifier ?? "" } as never, {} as never);
	const executions = ((listed as unknown as { executions?: Array<Record<string, unknown>> }).executions) ?? [];
	return executions.slice(0, 20).map((item) => ({
		name: String(item.name ?? ""),
		status: String(item.status ?? "unknown"),
		startedAt: toIso(item.createdAt ?? item.startedAt),
		endedAt: toIso(item.endedAt),
		durationMs: durationOf(item.createdAt ?? item.startedAt, item.endedAt),
	}));
}

function toIso(value: unknown): string | null {
	if (!value) return null;
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "string") return value;
	return null;
}

function durationOf(start: unknown, end: unknown): number | null {
	const started = toIso(start);
	const ended = toIso(end);
	if (!started || !ended) return null;
	const ms = Date.parse(ended) - Date.parse(started);
	return Number.isFinite(ms) ? ms : null;
}


