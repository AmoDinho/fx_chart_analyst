import { workflow } from "sst/aws/workflow";
import { publishAlert } from "../alerts";
import { S3ObjectStore } from "../storage/s3";
import { DynamoDocs } from "../storage/dynamo";
import { AnalysisRepo } from "../storage/repo";
import { workflowResources } from "../resources";
import { runDaily, type WorkflowCtx } from "./run";

export const handler = workflow.handler(async (event, ctx) => {
	const resources = await workflowResources();
	const deps = {
		captureFunctionName: resources.captureFunctionName,
		objects: new S3ObjectStore(resources.bucket),
		repo: new AnalysisRepo(new DynamoDocs(resources.table, { gsi1: resources.gsi1, gsi2: resources.gsi2 })),
		apiKey: resources.deepseekApiKey,
		telegram: { token: resources.telegramToken, chatId: resources.telegramChatId },
		viewerOrigin: resources.viewerOrigin ?? null,
		alert: publishAlert(resources.alertsTopicArn),
	};
	return runDaily(event, ctx as unknown as WorkflowCtx, deps);
});
