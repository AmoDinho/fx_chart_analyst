import { DynamoDocs } from "../storage/dynamo";
import { AnalysisRepo } from "../storage/repo";
import { S3ObjectStore } from "../storage/s3";
import { storageResources, type StorageResources } from "../resources";

export type ApiContext = {
	resources: StorageResources;
	objects: S3ObjectStore;
	repo: AnalysisRepo;
};

export async function apiContext(): Promise<ApiContext> {
	const resources = await storageResources();
	return {
		resources,
		objects: new S3ObjectStore(resources.bucket),
		repo: new AnalysisRepo(new DynamoDocs(resources.table, { gsi1: resources.gsi1, gsi2: resources.gsi2 })),
	};
}

export async function chartLinks(
	objects: S3ObjectStore,
	charts: { timeframe: string; key: string; width: number; height: number }[],
) {
	return Promise.all(
		charts.map(async (chart) => ({
			timeframe: chart.timeframe,
			url: await objects.presignGet(chart.key),
			width: chart.width,
			height: chart.height,
		})),
	);
}
