# NormalizedFact

**Category:** submission

**Description:** Normalized fact with canonical key, value, citations, and confidence

## JSON Schema

See [NormalizedFact.json](../../../packages/protocol/generated/json-schema/submission/NormalizedFact.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `canonicalKey` | string | ✓ |  |  |
| `value` | object | ✓ |  |  |
| `normalizedValue` | object |  |  |  |
| `type` | string | ✓ |  |  |
| `unit` | string |  |  |  |
| `currency` | string |  |  | pattern: `^[A-Z]{3}$` |
| `scale` | integer |  |  | minimum: -9007199254740991<br>maximum: 9007199254740991 |
| `period` | object |  |  |  |
| `origin` | object |  |  |  |
| `citations` | array<`__schema0`> | ✓ |  |  |
| `confidence` | number |  |  | minimum: 0<br>maximum: 1 |
| `conflictGroup` | string |  |  |  |

## Definitions

### __schema0

---
*Generated from Zod schema. Do not edit directly.*
