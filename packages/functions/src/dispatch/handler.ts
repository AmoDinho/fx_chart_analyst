import { workflowTarget } from "../resources";
import { log } from "../log";
import { parseDispatchEvent, planDispatch } from "./start";
import { startWorkflow } from "./invoke";

export async function handler(event: unknown) {
	const request = parseDispatchEvent(event);
	const plan = planDispatch(request);
	const resources = await workflowTarget();
	const started = await startWorkflow(plan, {
		name: resources.workflowName,
		qualifier: resources.workflowQualifier,
	});
	log({
		event: "dispatch.start",
		runId: plan.executionName,
		asset: plan.payload.assets.join(","),
		step: "dispatch",
		created: started.created,
		phase: plan.payload.phase,
	});
	return started;
}
