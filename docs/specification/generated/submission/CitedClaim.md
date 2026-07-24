# CitedClaim

**Category:** submission

**Description:** Cited claim with evidence references and confidence

## JSON Schema

See [CitedClaim.json](../../../../packages/protocol/generated/json-schema/submission/CitedClaim.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `claim` | string | ✓ |  |  |
| `evidence` | array<`object`> | ✓ |  |  |
| `confidence` | number | ✓ |  | minimum: 0<br>maximum: 1 |

---
*Generated from Zod schema. Do not edit directly.*
