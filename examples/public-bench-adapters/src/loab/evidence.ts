import type {
  CaseFixtureData,
  DocumentFixture,
  RecordFixture,
} from "@uwbench/tool-runtime";
import { emptyCaseFixtures, textDocument } from "../fixtures.js";
import { applicationDocuments, documentsSubmitted } from "./facts.js";
import type {
  LoabApplicantProfile,
  LoabProcessTrace,
  LoabTask,
} from "./types.js";

export interface LoabEvidenceExhibit {
  documentId: string;
  sourceId: string;
  title: string;
  fileName: string;
  documentType: string;
  content: string;
}

/**
 * Product-supported exhibit types. Inferred from the credit-file role
 * (application doc key or mock tool name), never from a task id.
 */
export function exhibitTypeForRole(role: string): string {
  const blob = role.toLowerCase().replaceAll("_", " ");
  if (/privacy|consent/.test(blob)) return "privacy-consent";
  if (/payslip|employment letter|employer/.test(blob)) return "payslip";
  if (/bank statement/.test(blob)) return "bank-statement";
  if (
    /passport|driver|licence|license|medicare|identity|greenid|kyc/.test(blob)
  ) {
    return "identity";
  }
  if (/equifax|bureau|credit report/.test(blob)) return "credit-report";
  if (/corelogic|valuation|appraisal/.test(blob)) return "property-valuation";
  if (/ato|income verif|tax return|notice of assessment/.test(blob)) {
    return "income-verification";
  }
  if (/asic|abn|company registration/.test(blob)) return "company-registration";
  if (/application form|mortgage application|loan request/.test(blob)) {
    return "loan-application";
  }
  if (/contract of sale|purchase contract/.test(blob))
    return "purchase-contract";
  if (/policy/.test(blob)) return "credit-policy";
  if (/financial statement|income statement|p&l/.test(blob)) {
    return "financial-statement";
  }
  return "supporting-document";
}

/**
 * Split the LOAB credit file + mock verification pack into separate
 * uploadable exhibits. The product chase/completeness gate reads
 * document-typed evidence and put_document_text layers, not a single
 * JSON blob labeled financial-statement.
 */
export function loabEvidenceExhibits(
  task: LoabTask,
  process?: LoabProcessTrace,
): LoabEvidenceExhibit[] {
  const exhibits: LoabEvidenceExhibit[] = [];
  const profile = task.profile;
  const pending = task.pending;

  if (profile) {
    exhibits.push(
      exhibit(
        "applicant-profile",
        "loan-application",
        "Applicant profile and loan request",
        renderProfile(profile, task.situation),
      ),
    );
  }

  const submitted = documentsSubmitted(pending);
  const docs = applicationDocuments(pending);
  const keys = unique([...Object.keys(docs), ...submitted]);
  for (const key of keys) {
    const body = docs[key] ?? { provided: submitted.includes(key) };
    if (isExplicitlyAbsent(body)) continue;
    exhibits.push(
      exhibit(
        slug(key),
        exhibitTypeForRole(key),
        humanize(key),
        renderRecord(humanize(key), body),
      ),
    );
  }

  if (process) {
    const policyHits: Record<string, unknown>[] = [];
    const productHits: Record<string, unknown>[] = [];
    for (const step of process.transcript) {
      for (const call of step.tool_calls) {
        if (call.name === "policy_lookup") {
          policyHits.push({
            section: call.arguments["section"] ?? null,
            result: call.result ?? null,
          });
          continue;
        }
        if (call.name === "product_lookup") {
          productHits.push({
            arguments: call.arguments,
            result: call.result ?? null,
          });
          continue;
        }
        exhibits.push(
          exhibit(
            slug(call.name),
            exhibitTypeForRole(call.name),
            `${humanize(call.name)} (mock verification)`,
            renderRecord(`${humanize(call.name)} mock verification`, {
              tool: call.name,
              arguments: call.arguments,
              result: call.result ?? null,
            }),
          ),
        );
      }
    }
    if (policyHits.length > 0) {
      exhibits.push(
        exhibit(
          "policy-pack",
          "credit-policy",
          "Retrieved credit policy excerpts",
          renderRecord("Policy lookups", policyHits),
        ),
      );
    }
    if (productHits.length > 0) {
      exhibits.push(
        exhibit(
          "product-lookup",
          "supporting-document",
          "Product lookup",
          renderRecord("Product lookup", productHits),
        ),
      );
    }
  }

  return mergeExhibitsByType(dedupeExhibits(exhibits));
}

export function loabEvidenceFixtures(
  task: LoabTask,
  process: LoabProcessTrace | undefined,
  constructNotice: string,
): CaseFixtureData {
  const exhibits = loabEvidenceExhibits(task, process);
  const documents: DocumentFixture[] = [
    ...exhibits.map((item) =>
      textDocument({
        documentId: `doc_${item.documentId}`,
        sourceId: item.sourceId,
        title: item.title,
        fileName: item.fileName,
        mimeType: "text/plain",
        content: item.content,
      }),
    ),
    textDocument({
      documentId: "doc_loab_construct",
      sourceId: "src_loab_construct",
      title: "Construct notice",
      fileName: "construct-mismatch.txt",
      content: [
        constructNotice,
        "",
        "KYC/bureau tools were already executed against LOAB's in-repo mocks.",
        "Do not originate, disburse, call a live bureau, or submit a SAR.",
        "Emit a structured proposedDecision on the product memo path.",
        "If privacy consent is missing, proposedDecision must be INSUFFICIENT_INFORMATION.",
      ].join("\n"),
    }),
  ];
  return emptyCaseFixtures({
    documents,
    records: loabEvidenceRecords(task, process),
  });
}

export function loabEvidenceRecords(
  task: LoabTask,
  process?: LoabProcessTrace,
): RecordFixture[] {
  const records: RecordFixture[] = [
    {
      recordId: "record_loab_applicant",
      sourceId: "src_loab_applicant_profile",
      record: {
        legal_name: task.profile?.personal["full_name"] ?? task.taskId,
        ...(task.profile ?? {}),
      },
    },
  ];
  if (!process) return records;
  for (const step of process.transcript) {
    for (const call of step.tool_calls) {
      records.push({
        recordId: `record_loab_${slug(call.name)}`,
        sourceId: `src_loab_${slug(call.name)}`,
        record: {
          tool: call.name,
          arguments: call.arguments,
          result: call.result ?? null,
        },
      });
    }
  }
  return records;
}

function exhibit(
  id: string,
  documentType: string,
  title: string,
  content: string,
): LoabEvidenceExhibit {
  const documentId = slug(id);
  return {
    documentId,
    sourceId: `src_loab_${documentId}`,
    title,
    fileName: `${documentId}.txt`,
    documentType,
    content,
  };
}

function renderProfile(
  profile: LoabApplicantProfile,
  situation: string,
): string {
  return [
    "# Applicant profile and loan request",
    situation.trim(),
    "",
    renderRecord("personal", profile.personal),
    profile.income ? renderRecord("income", profile.income) : "",
    profile.liabilities ? renderRecord("liabilities", profile.liabilities) : "",
    profile.assets ? renderRecord("assets", profile.assets) : "",
    profile.household ? renderRecord("household", profile.household) : "",
    profile.expenses ? renderRecord("expenses", profile.expenses) : "",
    profile.loan_request
      ? renderRecord("loan_request", profile.loan_request)
      : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function renderRecord(title: string, value: unknown): string {
  return [`# ${title}`, JSON.stringify(value, null, 2)].join("\n");
}

function isExplicitlyAbsent(body: Record<string, unknown>): boolean {
  if (body["provided"] === false) return true;
  if (body["consent_signed"] === false) return true;
  return false;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replaceAll(/\s+/g, " ").trim();
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 80) || "exhibit"
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeExhibits(
  exhibits: LoabEvidenceExhibit[],
): LoabEvidenceExhibit[] {
  const seen = new Set<string>();
  const out: LoabEvidenceExhibit[] = [];
  for (const item of exhibits) {
    if (seen.has(item.documentId)) continue;
    seen.add(item.documentId);
    out.push(item);
  }
  return out;
}

/**
 * One upload per product documentType. Same-type roles (passport + GreenID,
 * profile + application form) share a typed exhibit so the chat-path does
 * not reserve a dozen upload URLs for one credit file.
 */
function mergeExhibitsByType(
  exhibits: LoabEvidenceExhibit[],
): LoabEvidenceExhibit[] {
  const grouped = new Map<string, LoabEvidenceExhibit[]>();
  for (const item of exhibits) {
    const list = grouped.get(item.documentType) ?? [];
    list.push(item);
    grouped.set(item.documentType, list);
  }
  const out: LoabEvidenceExhibit[] = [];
  for (const [documentType, items] of grouped) {
    const first = items[0];
    if (!first) continue;
    if (items.length === 1) {
      out.push(first);
      continue;
    }
    out.push(
      exhibit(
        documentType,
        documentType,
        items.map((item) => item.title).join("; "),
        items.map((item) => item.content).join("\n\n"),
      ),
    );
  }
  return out;
}
