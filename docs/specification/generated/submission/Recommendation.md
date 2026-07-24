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
| `proposedAmount` | object |  |  |  |
| `proposedTermMonths` | integer |  |  | maximum: 9007199254740991<br>exclusiveMinimum: 0 |
| `conditions` | array<`object`> | ✓ |  |  |
| `policyExceptions` | array<`object`> | ✓ |  |  |
| `rationale` | array<`object`> | ✓ |  |  |

---
*Generated from Zod schema. Do not edit directly.*
