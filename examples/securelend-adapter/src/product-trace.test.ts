import { describe, expect, it } from "vitest";
import {
  attachProductTrace,
  compactProductTrace,
  mergeProductTrace,
  pickProductTrace,
  productTraceFromError,
} from "./product-trace.js";

describe("product trace", () => {
  it("picks first-class chase and decision fields without inventing them", () => {
    expect(
      pickProductTrace({
        workspaceId: "ws_1",
        jobId: "job_1",
        proposedDecision: "INSUFFICIENT_INFORMATION",
        documentChase: { needed: ["title_search"], have: ["payslip"] },
        missingDiligence: ["title_search"],
        fileStatus: { complete: false },
      }),
    ).toEqual({
      workspaceId: "ws_1",
      jobId: "job_1",
      proposedDecision: "INSUFFICIENT_INFORMATION",
      documentChase: { needed: ["title_search"], have: ["payslip"] },
      missingDiligence: ["title_search"],
      fileStatus: { complete: false },
    });
  });

  it("reads fields from memo/workspace wrappers and does not drop objects", () => {
    expect(
      pickProductTrace({
        memo: {
          proposed_decision: { decision: "DECLINE" },
          memoId: "memo_9",
        },
        workspace: { file_status: { complete: true } },
      }),
    ).toEqual({
      proposedDecision: { decision: "DECLINE" },
      memoId: "memo_9",
      fileStatus: { complete: true },
    });
  });

  it("merges layers without overwriting an earlier present field", () => {
    expect(
      mergeProductTrace(
        { workspaceId: "ws_1", jobId: "job_1" },
        { proposedDecision: "REFER", jobId: "job_ignored" },
        { documentChase: ["bank-statement"] },
      ),
    ).toEqual({
      workspaceId: "ws_1",
      jobId: "job_1",
      proposedDecision: "REFER",
      documentChase: ["bank-statement"],
    });
  });

  it("attaches the trace onto thrown errors so failed uploads keep workspaceId", () => {
    try {
      attachProductTrace(new Error("reserve failed"), {
        workspaceId: "ws_1",
      });
    } catch (error) {
      expect(productTraceFromError(error)).toEqual({ workspaceId: "ws_1" });
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("reserve failed");
    }
    expect(compactProductTrace({})).toBeUndefined();
  });
});
