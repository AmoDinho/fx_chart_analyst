import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { DispatchPlan } from "./start";
import { isAlreadyStarted } from "./start";

export async function startWorkflow(
	plan: DispatchPlan,
	target: { name: string; qualifier?: string },
	client = new LambdaClient({}),
): Promise<{ executionName: string; created: boolean }> {
	try {
		await client.send(
			new InvokeCommand({
				FunctionName: target.name,
				Qualifier: target.qualifier,
				InvocationType: "Event",
				Payload: Buffer.from(JSON.stringify(plan.payload)),
				DurableExecutionName: plan.executionName,
			} as ConstructorParameters<typeof InvokeCommand>[0]),
		);
		return { executionName: plan.executionName, created: true };
	} catch (error) {
		if (isAlreadyStarted(error)) return { executionName: plan.executionName, created: false };
		throw error;
	}
}

export async function invokeJson<T>(
	functionName: string,
	payload: unknown,
	invocationType: "Event" | "RequestResponse",
	client = new LambdaClient({}),
): Promise<T | null> {
	const result = await client.send(
		new InvokeCommand({
			FunctionName: functionName,
			InvocationType: invocationType,
			Payload: Buffer.from(JSON.stringify(payload)),
		}),
	);
	if (!result.Payload) return null;
	const text = Buffer.from(result.Payload).toString("utf8");
	if (!text) return null;
	return JSON.parse(text) as T;
}
