# RiskFinding

**Category:** submission

**Description:** Participant risk finding with severity, evidence, and confidence

## JSON Schema

See [RiskFinding.json](../../json-schema/submission/RiskFinding.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `riskId` | string | ✓ |  |  |
| `category` | string | ✓ |  |  |
| `severity` | string | ✓ |  | enum: [CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL] |
| `statement` | string | ✓ |  | minLength: 1 |
| `evidence` | array<`object`> | ✓ |  |  |
| `confidence` | number | ✓ |  | minimum: 0<br>maximum: 1 |

---
*Generated from Zod schema. Do not edit directly.*
