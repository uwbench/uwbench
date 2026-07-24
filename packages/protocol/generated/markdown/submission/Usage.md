# Usage

**Category:** submission

**Description:** Token usage and provider-reported cost

## JSON Schema

See [Usage.json](../../../packages/protocol/generated/json-schema/submission/Usage.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `inputTokens` | integer |  |  | minimum: 0<br>maximum: 9007199254740991 |
| `outputTokens` | integer |  |  | minimum: 0<br>maximum: 9007199254740991 |
| `providerReportedCostUsd` | number |  |  | minimum: 0 |

---
*Generated from Zod schema. Do not edit directly.*
