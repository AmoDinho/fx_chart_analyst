import { storageResources } from "../resources";
import { S3ObjectStore } from "../storage/s3";
import { launchPage } from "./puppeteer";
import { captureAsset, parseCaptureInput } from "./session";

export async function handler(event: unknown) {
	const input = parseCaptureInput(event);
	const resources = await storageResources();
	const objects = new S3ObjectStore(resources.bucket);
	return captureAsset(input, objects, () => launchPage());
}
