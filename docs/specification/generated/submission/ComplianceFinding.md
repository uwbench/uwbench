# ComplianceFinding

**Category:** submission

**Description:** Compliance screening finding with match score and disposition

## JSON Schema

See [ComplianceFinding.json](../../../../../packages/protocol/generated/json-schema/submission/ComplianceFinding.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `subject` | string | ✓ |  |  |
| `provider` | string | ✓ |  |  |
| `matchScore` | number | ✓ |  | minimum: 0<br>maximum: 1 |
| `lists` | array<`string`> |  |  |  |
| `categories` | array<`string`> |  |  |  |
| `matchState` | string | ✓ |  | enum: [CLEAR, POSSIBLE_MATCH, CONFIRMED_MATCH] |
| `disposition` | string | ✓ |  | enum: [CLEARED, ESCALATED, PENDING_REVIEW] |

---
*Generated from Zod schema. Do not edit directly.*
