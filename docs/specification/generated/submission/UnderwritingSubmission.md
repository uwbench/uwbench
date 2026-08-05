# UnderwritingSubmission

**Category:** submission

**Description:** Complete underwriting submission (schemaVersion 1.0)

## JSON Schema

See [UnderwritingSubmission.json](../../../../packages/protocol/generated/json-schema/submission/UnderwritingSubmission.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

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
| `amount` | [`__schema1`](#__schema1) | ✓ |  |
| `currency` | [`__schema2`](#__schema2) | ✓ |  |

### __schema1

### __schema2

### __schema3

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `amount` | [`__schema4`](#__schema4) | ✓ |  |
| `currency` | [`__schema2`](#__schema2) | ✓ |  |

### __schema4

### __schema5

### __schema6

### __schema7

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sourceId` | string | ✓ |  |
| `documentId` | string |  |  |
| `page` | integer |  |  |
| `startOffset` | integer |  |  |
| `endOffset` | integer |  |  |

### __schema8

### __schema9

### __schema10

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `claim` | string | ✓ |  |
| `evidence` | array | ✓ |  |
| `confidence` | number | ✓ |  |

---
*Generated from Zod schema. Do not edit directly.*
