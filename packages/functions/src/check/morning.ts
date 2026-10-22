import { utcDate } from "@fx/core/capture/config";
import { publishAlert } from "../alerts";
import { log } from "../log";
import { storageResources } from "../resources";
import { DynamoDocs } from "../storage/dynamo";
import { dayPk, reportSk } from "../storage/items";

export async function handler() {
	const resources = await storageResources();
	const date = utcDate();
	const docs = new DynamoDocs(resources.table, { gsi1: resources.gsi1, gsi2: resources.gsi2 });
	const nasdaq = await docs.get(dayPk(date), reportSk("nasdaq100"));
	const gold = await docs.get(dayPk(date), reportSk("gold"));
	if (nasdaq && gold) {
		log({ event: "morning.ok", runId: `check-${date}`, asset: "both", step: "morning-check" });
		return { ok: true, date };
	}
	const missing = [nasdaq ? null : "nasdaq100", gold ? null : "gold"].filter(Boolean).join(", ");
	await publishAlert(process.env.ALERTS_TOPIC_ARN)({
		kind: "failure",
		asset: missing || "both",
		date,
		runId: `check-${date}`,
		message: `no REPORT item for ${missing || "today"} by 08:00 UTC`,
	});
	return { ok: false, date, missing };
}
