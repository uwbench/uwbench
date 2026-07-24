# CaseGetDocumentMetadataOutput

**Category:** tools

**Description:** Output for case.get_document_metadata

## JSON Schema

See [CaseGetDocumentMetadataOutput.json](../../../packages/protocol/generated/json-schema/tools/CaseGetDocumentMetadataOutput.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `documentId` | string | ✓ |  |  |
| `title` | string | ✓ |  |  |
| `mimeType` | string | ✓ |  |  |
| `pageCount` | integer | ✓ |  | minimum: 0<br>maximum: 9007199254740991 |
| `sizeBytes` | integer | ✓ |  | minimum: 0<br>maximum: 9007199254740991 |
| `sha256` | string | ✓ |  | minLength: 64<br>maxLength: 64 |

---
*Generated from Zod schema. Do not edit directly.*
