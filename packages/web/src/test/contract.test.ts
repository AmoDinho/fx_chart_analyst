import { describe, expect, it } from "vitest";
import { reportResponseSchema } from "@fx/core/api";
import { extractRange } from "@fx/core/report/range";
import { recordedReportFixture } from "../fixtures";

describe("report contract", () => {
  it("parses the recorded report fixture with reportResponseSchema", () => {
    const parsed = reportResponseSchema.parse(recordedReportFixture);
    expect(parsed.analysis.asset).toBe("nasdaq100");
    expect(parsed.analysis.verdict.direction).toBe("long");
    expect(parsed.analysis.verdict.grade).toBe("A+");
    expect(parsed.charts).toHaveLength(3);
    expect(extractRange(parsed.analysis)).toMatchObject({ high: 24961, low: 24452, side: "premium" });
  });
});
