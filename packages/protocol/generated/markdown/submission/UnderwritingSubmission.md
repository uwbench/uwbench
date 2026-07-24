# UnderwritingSubmission

**Category:** submission

**Description:** Complete underwriting submission (schemaVersion 1.0)

## JSON Schema

See [UnderwritingSubmission.json](../../json-schema/submission/UnderwritingSubmission.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `schemaVersion` | string | ✓ |  |  |
| `financialSpread` | object | ✓ |  |  |
| `normalizedFacts` | array<`object`> | ✓ |  |  |
| `risks` | array<`object`> | ✓ |  |  |
| `discrepancies` | array<`object`> | ✓ |  |  |
| `complianceFindings` | array<`object`> | ✓ |  |  |
| `followUpRequests` | array<`object`> | ✓ |  |  |
| `policyAssessment` | object | ✓ |  |  |
| `recommendation` | object | ✓ |  |  |
| `memo` | object | ✓ |  |  |
| `confidence` | object | ✓ |  |  |
| `usage` | object |  |  |  |

## Definitions

### __schema0

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `amount` | integer | ✓ |  |
| `currency` | [`__schema1`](#__schema1) | ✓ |  |

### __schema1

### __schema2

### __schema3

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `claim` | string | ✓ |  |
| `evidenceIds` | array | ✓ |  |
| `confidence` | number | ✓ |  |

---
*Generated from Zod schema. Do not edit directly.*
