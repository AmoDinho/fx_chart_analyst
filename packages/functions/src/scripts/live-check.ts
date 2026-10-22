import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { Resource } from "sst";
import { utcDate } from "@fx/core/capture/config";

const client = new LambdaClient({});
const date = utcDate();
let failed = false;

for (const asset of ["nasdaq100", "gold"] as const) {
  const result = await client.send(
    new InvokeCommand({
      FunctionName: Resource.Capture.name,
      Payload: Buffer.from(
        JSON.stringify({
          asset,
          date,
          timeframes: ["1D", "30m", "3h"],
          force: true,
          store: false,
          id: crypto.randomUUID(),
        }),
      ),
    }),
  );
  const body = JSON.parse(Buffer.from(result.Payload ?? []).toString("utf8")) as {
    quality?: string;
    fatal?: string;
    stored?: Array<{ timeframe: string; width: number; height: number; verified: boolean }>;
    notes?: string[];
  };
  const summary = (body.stored ?? []).map((frame) => `${frame.timeframe} ${frame.width}x${frame.height} verified=${frame.verified}`).join(", ");
  console.log(JSON.stringify({ asset, quality: body.quality, fatal: body.fatal, summary, notes: body.notes }));
  if (body.fatal || body.quality !== "ok" || (body.stored ?? []).some((frame) => !frame.verified || frame.width < 600 || frame.height < 300)) {
    failed = true;
  }
}

if (failed) process.exit(1);
