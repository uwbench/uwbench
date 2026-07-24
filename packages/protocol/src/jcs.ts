/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) for I-JSON values.
 *
 * Object keys are serialized directly in UTF-16 lexical order. Building a
 * sorted object and calling JSON.stringify is not sufficient because
 * ECMAScript reorders integer-like property names numerically.
 */

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        throw new TypeError("JCS rejects unpaired high surrogates");
      }
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new TypeError("JCS rejects unpaired high surrogates");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("JCS rejects unpaired low surrogates");
    }
  }
}

function serializeString(value: string): string {
  assertUnicodeScalarString(value);
  return JSON.stringify(value);
}

export function canonicalizeJcs(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return serializeString(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("JCS rejects non-finite numbers");
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalizeJcs(item)).join(",")}]`;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("JCS accepts only plain JSON objects");
      }

      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys
        .map((key) => `${serializeString(key)}:${canonicalizeJcs(record[key])}`)
        .join(",")}}`;
    }
    default:
      throw new TypeError(`JCS rejects values of type ${typeof value}`);
  }
}
