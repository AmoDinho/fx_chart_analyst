import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { poorCaptureReport, recordedReportFixture, uncitedReport } from "../fixtures";
import { ReportView } from "../pages/report";

function renderReport(report: typeof recordedReportFixture, asset: string, date: string) {
  return render(
    <MemoryRouter>
      <ReportView asset={asset} date={date} report={report} />
    </MemoryRouter>,
  );
}

describe("report page", () => {
  it("shows a poor-capture warning and still shows bias and verdict", () => {
    renderReport(poorCaptureReport, "nasdaq100", "2026-10-19");
    const alert = screen.getByRole("alert");
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent(/poor capture/i);
    expect(alert).toHaveTextContent(/capture warning/i);
    expect(screen.getByTestId("bias")).toHaveTextContent(/bullish/i);
    expect(screen.getByTestId("verdict")).toHaveTextContent(/stand aside/i);
    expect(screen.getByTestId("verdict")).toBeVisible();
    expect(alert.compareDocumentPosition(screen.getByTestId("verdict")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows a grounding warning above the verdict when an ok capture has no citations", () => {
    renderReport(uncitedReport, "gold", "2026-10-18");
    const alert = screen.getByRole("alert");
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent(/grounding warning/i);
    expect(alert).toHaveTextContent(/method_citations/i);
    expect(screen.getByTestId("verdict")).toHaveTextContent(/short/i);
    expect(alert.compareDocumentPosition(screen.getByTestId("verdict")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders PASS, FAIL and NOT VISIBLE checklist badges", () => {
    renderReport(recordedReportFixture, "nasdaq100", "2026-10-22");
    expect(screen.getAllByText("PASS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("FAIL").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NOT VISIBLE").length).toBeGreaterThan(0);
  });
});
