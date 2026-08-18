import { randomUUID } from "node:crypto";
import { asRecord, firstString } from "./mcp-client.js";
import type { CaseDocument } from "./case-package.js";

export interface PresignedUpload {
  documentId?: string;
  fileName?: string;
  uploadUrl: string;
  uploadFields?: Record<string, string>;
  method?: "PUT" | "POST";
}

export function interpretSubmitDocumentsResult(
  result: unknown,
): PresignedUpload[] {
  const record = asRecord(result);
  if (!record) return [];
  const nested = asRecord(record["result"]) ?? record;
  const collections = [nested["documents"], nested["uploads"], nested["files"]];
  for (const collection of collections) {
    if (Array.isArray(collection)) {
      return collection
        .map((item) => interpretSingleUpload(item))
        .filter((item): item is PresignedUpload => item !== undefined);
    }
  }
  const single = interpretSingleUpload(nested);
  return single ? [single] : [];
}

function interpretSingleUpload(value: unknown): PresignedUpload | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const uploadUrl =
    firstString(record, "uploadUrl", "url", "presignedUrl") ??
    firstString(asRecord(record["upload"]), "url", "uploadUrl");
  if (!uploadUrl) return undefined;
  const fieldsRaw =
    asRecord(record["uploadFields"]) ??
    asRecord(record["fields"]) ??
    asRecord(asRecord(record["upload"])?.["fields"]);
  const uploadFields = stringifyFields(fieldsRaw);
  const methodRaw = firstString(record, "method", "httpMethod");
  const method =
    methodRaw?.toUpperCase() === "POST" ||
    (uploadFields && Object.keys(uploadFields).length > 0)
      ? "POST"
      : "PUT";
  const documentId = firstString(record, "documentId", "id");
  const fileName = firstString(record, "fileName", "filename", "name");
  const parsed: PresignedUpload = {
    uploadUrl,
    method,
    ...(documentId ? { documentId } : {}),
    ...(fileName ? { fileName } : {}),
    ...(uploadFields ? { uploadFields } : {}),
  };
  return parsed;
}

function stringifyFields(
  fields: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!fields) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function uploadBytes(
  target: PresignedUpload,
  file: CaseDocument,
  fetchImpl: typeof fetch,
): Promise<void> {
  const method = target.method ?? (target.uploadFields ? "POST" : "PUT");
  if (method === "POST" && target.uploadFields) {
    const encoded = encodeMultipart(
      target.uploadFields,
      file.fileName ?? `${file.documentId}.bin`,
      file.mimeType,
      file.bytes,
    );
    const response = await fetchImpl(target.uploadUrl, {
      method: "POST",
      headers: { "content-type": encoded.contentType },
      body: new Uint8Array(encoded.body),
    });
    if (!response.ok) {
      throw new Error(
        `Document upload POST failed with HTTP ${response.status}`,
      );
    }
    return;
  }
  const response = await fetchImpl(target.uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.mimeType },
    body: new Uint8Array(file.bytes),
  });
  if (!response.ok) {
    throw new Error(`Document upload PUT failed with HTTP ${response.status}`);
  }
}

export async function finalizeUploadedDocument(
  documentApiUrl: string,
  payload: Record<string, unknown>,
  token: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchImpl(documentApiUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(
      `Document finalize failed with HTTP ${response.status} at configured SECURELEND_DOCUMENT_API_URL`,
    );
  }
}

function encodeMultipart(
  fields: Record<string, string>,
  fileName: string,
  mimeType: string,
  bytes: Buffer,
): { body: Buffer; contentType: string } {
  const boundary = `----UWBenchFormBoundary${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (name === "file") continue;
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeDisposition(name)}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${escapeDisposition(fileName)}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
  );
  chunks.push(bytes);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function escapeDisposition(value: string): string {
  return value.replaceAll('"', "");
}

export function matchUpload(
  uploads: PresignedUpload[],
  file: CaseDocument,
  index: number,
): PresignedUpload | undefined {
  const byName = uploads.find(
    (item) => item.fileName && item.fileName === file.fileName,
  );
  if (byName) return byName;
  const byId = uploads.find((item) => item.documentId === file.documentId);
  if (byId) return byId;
  return uploads[index] ?? uploads[0];
}
