type Linked = Record<string, Record<string, string | undefined> | undefined>;

async function resourceMap(): Promise<Linked> {
	const { Resource } = await import("sst");
	return Resource as unknown as Linked;
}

export type StorageResources = {
	bucket: string;
	table: string;
	region: string;
	gsi1: string;
	gsi2: string;
	viewerOrigin?: string;
};

export async function storageResources(): Promise<StorageResources> {
	const linked = await resourceMap();
	return {
		bucket: required(linked.Artifacts?.name, "Artifacts.name"),
		table: required(linked.Analyses?.name, "Analyses.name"),
		region: process.env.AWS_REGION ?? "eu-west-1",
		gsi1: process.env.ANALYSES_GSI1 ?? "gsi1",
		gsi2: process.env.ANALYSES_GSI2 ?? "gsi2",
		viewerOrigin: process.env.VIEWER_ORIGIN,
	};
}

export type WorkflowResources = StorageResources & {
	captureFunctionName: string;
	workflowName: string;
	workflowQualifier?: string;
	alertsTopicArn?: string;
	telegramToken?: string;
	telegramChatId?: string;
};

export async function workflowTarget(): Promise<{ workflowName: string; workflowQualifier?: string }> {
	const linked = await resourceMap();
	return {
		workflowName: required(linked.DailyAnalysis?.name, "DailyAnalysis.name"),
		workflowQualifier: linked.DailyAnalysis?.qualifier,
	};
}

export async function workflowResources(): Promise<WorkflowResources> {
	const linked = await resourceMap();
	const storage = await storageResources();
	return {
		...storage,
		captureFunctionName: required(linked.Capture?.name, "Capture.name"),
		workflowName: required(linked.DailyAnalysis?.name, "DailyAnalysis.name"),
		workflowQualifier: linked.DailyAnalysis?.qualifier,
		alertsTopicArn: linked.Alerts?.arn,
		telegramToken: linked.TelegramBotToken?.value,
		telegramChatId: linked.TelegramChatId?.value,
	};
}

export async function dispatchResources(): Promise<WorkflowResources & { dispatchFunctionName: string }> {
	const linked = await resourceMap();
	const workflow = await workflowResources();
	return {
		...workflow,
		dispatchFunctionName: required(linked.Dispatch?.name, "Dispatch.name"),
	};
}

function required(value: string | undefined, name: string): string {
	if (!value) throw new Error(`linked resource missing: ${name}`);
	return value;
}
