import { describe, expect, it } from "vitest";
import { chaseGapsFromUnknown, workspaceHintFromUnknown } from "./chase.js";

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
});
