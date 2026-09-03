import { describe, expect, it } from "vitest";
import { unpublishedLoabReport } from "../run-report.js";
import {
  chaseGapsFromUnknown,
  productTraceFromUnknown,
  workspaceHintFromUnknown,
} from "./chase.js";

describe("product chase gap reporting", () => {
  it("collects missing-document lists without inventing a decision", () => {
    expect(
      chaseGapsFromUnknown({
        proposedDecision: "INSUFFICIENT_INFORMATION",
        missingDocuments: ["financial_statement", "tax_return"],
        recommendation: {
          followUpRequests: [{ document: "audited_financials" }],
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          key: "missingDocuments",
          items: ["financial_statement", "tax_return"],
        },
        { key: "followUpRequests", items: ["audited_financials"] },
      ]),
    );
  });

  it("reads workspace id from the memo payload", () => {
    expect(
      workspaceHintFromUnknown({
        workspaceId: "ws_abc",
        memo: { markdown: "Workspace: uwbench-case (ws_abc)" },
      }),
    ).toBe("ws_abc");
  });

  it("keeps raw product fields from the adapter productTrace sibling", () => {
    const raw = {
      status: "completed",
      productTrace: {
        workspaceId: "ws_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        jobId: "job_memo_1",
        memoId: "memo_1",
        proposedDecision: "REQUEST_FURTHER_INFO",
        documentChase: { needed: ["title_search"], have: ["payslip"] },
        missingDiligence: ["title_search"],
        fileStatus: { complete: false },
      },
    };
    const trace = productTraceFromUnknown(raw);
    expect(trace).toEqual(raw.productTrace);
    expect(workspaceHintFromUnknown(raw)).toBe(
      "ws_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    if (!trace) throw new Error("expected product trace");
    const report = unpublishedLoabReport({
      itemId: "origination/sample",
      productTrace: trace,
    });
    expect(report.workspaceId).toBe(
      "ws_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(report.jobId).toBe("job_memo_1");
    expect(report.memoId).toBe("memo_1");
    expect(report.proposedDecision).toBe("REQUEST_FURTHER_INFO");
    expect(report.documentChase).toEqual({
      needed: ["title_search"],
      have: ["payslip"],
    });
    expect(report.missingDiligence).toEqual(["title_search"]);
    expect(report.fileStatus).toEqual({ complete: false });
    expect(report.product).toEqual(raw.productTrace);
  });

  it("collects documentChase / missingDiligence / fileStatus as chase gaps", () => {
    expect(
      chaseGapsFromUnknown({
        documentChase: [{ document: "privacy_consent" }],
        missingDiligence: ["identity_verification"],
        fileStatus: [{ name: "inspection", status: "missing" }],
      }),
    ).toEqual(
      expect.arrayContaining([
        { key: "documentChase", items: ["privacy_consent"] },
        { key: "missingDiligence", items: ["identity_verification"] },
        { key: "fileStatus", items: ["inspection"] },
      ]),
    );
  });
});
