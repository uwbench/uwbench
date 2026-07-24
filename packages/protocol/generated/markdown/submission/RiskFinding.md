# RiskFinding

**Category:** submission

**Description:** Risk finding with severity, weight, evidence, and acceptable concepts

## JSON Schema

See [RiskFinding.json](../json-schema/submission/RiskFinding.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `riskId` | string | ✓ |  |  |
| `category` | string | ✓ |  |  |
| `severity` | string | ✓ |  | enum: [CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL] |
| `weight` | number | ✓ |  | minimum: 0<br>maximum: 1 |
| `requiredEvidence` | array<`string`> |  |  |  |
| `acceptableConcepts` | array<`string`> |  |  |  |
| `evidenceSupport` | array<`string`> |  |  |  |

---
*Generated from Zod schema. Do not edit directly.*
