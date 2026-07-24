# Discrepancy

**Category:** submission

**Description:** Discrepancy between sources with materiality assessment

## JSON Schema

See [Discrepancy.json](../../../packages/protocol/generated/json-schema/submission/Discrepancy.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `type` | string | ✓ |  |  |
| `description` | string | ✓ |  |  |
| `sourceA` | string | ✓ |  |  |
| `sourceB` | string | ✓ |  |  |
| `variance` | number |  |  |  |
| `materiality` | string | ✓ |  | enum: [IMMATERIAL, MATERIAL, CRITICAL] |
| `status` | string | ✓ |  | enum: [OPEN, RESOLVED, ACKNOWLEDGED] |

---
*Generated from Zod schema. Do not edit directly.*
