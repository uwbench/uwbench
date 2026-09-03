import { describe, expect, it } from "vitest";
import { CONSTRUCT } from "../construct.js";
import { bundledLoabOriginationSample } from "./load.js";
import {
  exhibitTypeForRole,
  loabEvidenceExhibits,
  loabEvidenceFixtures,
} from "./evidence.js";
import type { LoabProcessTrace } from "./types.js";

describe("LOAB evidence exhibits", () => {
  it("maps credit-file roles to product document types without task ids", () => {
    expect(exhibitTypeForRole("privacy_consent")).toBe("privacy-consent");
    expect(exhibitTypeForRole("payslips_x2")).toBe("payslip");
    expect(exhibitTypeForRole("bank_statements_6mo")).toBe("bank-statement");
    expect(exhibitTypeForRole("certified_passport")).toBe("identity");
    expect(exhibitTypeForRole("greenid_verify")).toBe("identity");
    expect(exhibitTypeForRole("equifax_pull")).toBe("credit-report");
    expect(exhibitTypeForRole("corelogic_valuation")).toBe(
      "property-valuation",
    );
    expect(exhibitTypeForRole("ato_income_verify")).toBe("income-verification");
    expect(exhibitTypeForRole("asic_lookup")).toBe("company-registration");
    expect(exhibitTypeForRole("mortgage_application_form")).toBe(
      "loan-application",
    );
  });

  it("merges same-type roles into one typed exhibit per product documentType", () => {
    const process: LoabProcessTrace = {
      gatewayKind: "loab_mock_data",
      stopReason: "terminal_decision:APPROVE",
      transcript: [
        {
          step: 1,
          agent: "processing_officer",
          allowed_tools: ["greenid_verify", "equifax_pull"],
          tool_calls: [
            {
              name: "policy_lookup",
              arguments: { section: "Section 4.2" },
              result: { data: { text: "mandatory docs" } },
            },
            {
              name: "greenid_verify",
              arguments: { full_name: "Example" },
              result: { data: { dvs_result: "PASS" } },
            },
            {
              name: "equifax_pull",
              arguments: { full_name: "Example" },
              result: { data: { score: 700 } },
            },
          ],
          assistant_response: "",
        },
      ],
      handoffs: [],
    };
    const exhibits = loabEvidenceExhibits(
      bundledLoabOriginationSample(),
      process,
    );
    const types = exhibits.map((item) => item.documentType);
    expect(types).toContain("loan-application");
    expect(types).toContain("payslip");
    expect(types).toContain("privacy-consent");
    expect(types).toContain("identity");
    expect(types).toContain("credit-report");
    expect(types.filter((type) => type === "credit-policy")).toHaveLength(1);
    expect(types.filter((type) => type === "identity")).toHaveLength(1);
    expect(types.filter((type) => type === "loan-application")).toHaveLength(1);
    expect(exhibits.some((item) => /dvs_result/.test(item.content))).toBe(true);
    expect(exhibits.some((item) => /"score": 700/.test(item.content))).toBe(
      true,
    );
    expect(JSON.stringify(exhibits)).not.toMatch(/origination\/task-0[1-6]/);
  });

  it("omits unsigned or unprovided consent instead of inventing it", () => {
    const sample = bundledLoabOriginationSample();
    sample.pending["application_documents"] = {
      privacy_consent: { provided: false, consent_signed: false },
      payslips_x2: { provided: true, base_income_annual: 100000 },
    };
    sample.pending["documents_submitted"] = ["payslips_x2"];
    const exhibits = loabEvidenceExhibits(sample);
    expect(
      exhibits.some((item) => item.documentType === "privacy-consent"),
    ).toBe(false);
    expect(exhibits.some((item) => item.documentType === "payslip")).toBe(true);
  });

  it("builds gateway fixtures as separate text exhibits, not one JSON blob", () => {
    const fixtures = loabEvidenceFixtures(
      bundledLoabOriginationSample(),
      undefined,
      CONSTRUCT.loab.mismatch,
    );
    expect(
      fixtures.documents.some(
        (doc) => doc.fileName === "loab-credit-file.json",
      ),
    ).toBe(false);
    expect(
      fixtures.documents.every((doc) => doc.mimeType !== "application/json"),
    ).toBe(true);
    expect(fixtures.records[0]?.record["legal_name"]).toBe(
      "Sarah Jane Mitchell",
    );
  });
});
