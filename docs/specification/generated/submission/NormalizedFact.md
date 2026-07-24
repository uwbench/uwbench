# NormalizedFact

**Category:** submission

**Description:** Normalized fact with canonical key, value, citations, and confidence

## JSON Schema

See [NormalizedFact.json](../json-schema/submission/NormalizedFact.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `canonicalKey` | string | ✓ |  |  |
| `value` | object | ✓ |  |  |
| `normalizedValue` | object |  |  |  |
| `type` | string | ✓ |  |  |
| `unit` | string |  |  |  |
| `currency` | string |  |  | minLength: 3<br>maxLength: 3 |
| `scale` | number |  |  |  |
| `period` | object |  |  |  |
| `origin` | object |  |  |  |
| `citations` | array<`__schema0`> | ✓ |  |  |
| `confidence` | number |  |  | minimum: 0<br>maximum: 1 |
| `conflictGroup` | string |  |  |  |

---
*Generated from Zod schema. Do not edit directly.*
