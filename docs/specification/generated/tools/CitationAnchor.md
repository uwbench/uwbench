# CitationAnchor

**Category:** tools

**Description:** Stable source and document location for tool evidence

## JSON Schema

See [CitationAnchor.json](../../../../packages/protocol/generated/json-schema/tools/CitationAnchor.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `sourceId` | string | ✓ |  | minLength: 1 |
| `documentId` | string |  |  | minLength: 1 |
| `page` | integer |  |  | maximum: 9007199254740991<br>exclusiveMinimum: 0 |
| `startOffset` | integer |  |  | minimum: 0<br>maximum: 9007199254740991 |
| `endOffset` | integer |  |  | minimum: 0<br>maximum: 9007199254740991 |

---
*Generated from Zod schema. Do not edit directly.*
