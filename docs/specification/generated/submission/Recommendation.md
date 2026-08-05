# Recommendation

**Category:** submission

**Description:** Underwriting recommendation with decision, confidence, and rationale

## JSON Schema

See [Recommendation.json](../../../../packages/protocol/generated/json-schema/submission/Recommendation.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `decision` | string | ✓ |  | enum: [APPROVE, APPROVE_WITH_CONDITIONS, REFER, DECLINE, INSUFFICIENT_INFORMATION] |
| `confidence` | number | ✓ |  | minimum: 0<br>maximum: 1 |
| `proposedAmount` | object |  | Nonnegative integer monetary amount in ISO 4217 minor units |  |
| `proposedTermMonths` | integer |  |  | maximum: 9007199254740991<br>exclusiveMinimum: 0 |
| `conditions` | array<`object`> | ✓ |  |  |
| `policyExceptions` | array<`object`> | ✓ |  |  |
| `rationale` | array<`object`> | ✓ |  |  |

## Definitions

### __schema0

### __schema1

### __schema2

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sourceId` | string | ✓ |  |
| `documentId` | string |  |  |
| `page` | integer |  |  |
| `startOffset` | integer |  |  |
| `endOffset` | integer |  |  |

---
*Generated from Zod schema. Do not edit directly.*
