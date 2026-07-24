# EvidenceReference

**Category:** common

**Description:** Canonical stable source, document, page, and range locator for evidence

## JSON Schema

See [EvidenceReference.json](../../json-schema/common/EvidenceReference.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

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
