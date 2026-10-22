import assert from "node:assert/strict";
import test from "node:test";
import { isAlreadyStarted, parseDispatchEvent, planDispatch } from "../src/dispatch/start";

test("weekday cron names the execution cron-YYYY-MM-DD and cannot carry force", () => {
	const plan = planDispatch({ source: "cron", phase: "full", now: Date.parse("2026-10-22T07:00:00.000Z"), force: true });
	assert.equal(plan.executionName, "cron-2026-10-22");
	assert.equal(plan.payload.force, false);
	assert.deepEqual(plan.payload.assets, ["nasdaq100", "gold"]);
	assert.equal(plan.payload.phase, "full");
});

test("admin analyse names follow the spec table", () => {
	const one = planDispatch({ source: "admin", phase: "analyse", date: "2026-10-22", asset: "gold", now: 1 });
	assert.equal(one.executionName, "analyse-gold-2026-10-22");
	const both = planDispatch({ source: "admin", phase: "analyse", date: "2026-10-22", now: 1 });
	assert.equal(both.executionName, "analyse-2026-10-22");
	const forced = planDispatch({ source: "admin", phase: "full", date: "2026-10-20", force: true, now: 1792491 });
	assert.equal(forced.executionName, "run-2026-10-20-1792491");
	assert.equal(forced.payload.force, true);
});

test("scheduler events are cron and admin bodies are not", () => {
	assert.equal(parseDispatchEvent({ source: "aws.scheduler" }, 1).source, "cron");
	assert.equal(parseDispatchEvent({ source: "admin", phase: "analyse", asset: "nasdaq100", date: "2026-10-22" }).phase, "analyse");
});

test("already-started errors are idempotent hits", () => {
	assert.equal(isAlreadyStarted(Object.assign(new Error("execution already exists"), { name: "ResourceConflictException" })), true);
	assert.equal(isAlreadyStarted(new Error("network down")), false);
});
