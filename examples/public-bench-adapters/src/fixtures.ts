import { createHash } from "node:crypto";
import type { CaseFixtureData, DocumentFixture } from "@uwbench/tool-runtime";

export function textDocument(options: {
  documentId: string;
  sourceId: string;
  title: string;
  content: string;
  fileName: string;
  mimeType?: string;
}): DocumentFixture {
  const content = options.content;
  const mimeType = options.mimeType ?? "text/plain";
  return {
    documentId: options.documentId,
    sourceId: options.sourceId,
    title: options.title,
    mimeType,
    pageCount: 1,
    sizeBytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
    pages: [{ pageNumber: 1, text: content }],
    fileName: options.fileName,
  };
}

/** Complete fixtures so ToolGateway does not merge DEFAULT_CASE_DATA leftovers. */
export function emptyCaseFixtures(
  overrides: Partial<CaseFixtureData> = {},
): CaseFixtureData {
  return {
    documents: overrides.documents ?? [],
    revealableDocuments: overrides.revealableDocuments ?? [],
    records: overrides.records ?? [],
    policies: overrides.policies ?? [],
    information: overrides.information ?? {},
  };
}
