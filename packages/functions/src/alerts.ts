import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import type { AlertPayload } from "./contracts";
import { log } from "./log";

export function publishAlert(topicArn: string | undefined, client = new SNSClient({})) {
	return async (message: AlertPayload) => {
		if (!topicArn) {
			log({ event: "alert.skipped", reason: "missing topic", runId: message.runId, asset: message.asset, step: "alert" });
			return;
		}
		await client.send(
			new PublishCommand({
				TopicArn: topicArn,
				Subject: `${message.kind} ${message.asset} ${message.date}`.slice(0, 100),
				Message: JSON.stringify(message),
			}),
		);
	};
}
