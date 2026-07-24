# RunRequest

**Category:** agent

**Description:** Agent run request

## JSON Schema

See [RunRequest.json](../../../packages/protocol/generated/json-schema/agent/RunRequest.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `schemaVersion` | string | ✓ |  |  |
| `benchmark` | string | ✓ |  |  |
| `benchmarkVersion` | string | ✓ |  |  |
| `lane` | string | ✓ |  | enum: [raw_documents, normalized_data, reasoning_only] |
| `caseId` | string | ✓ |  |  |
| `objective` | string | ✓ |  |  |
| `requiredOutputs` | array<`string`> | ✓ |  |  |
| `toolGateway` | object | ✓ |  |  |
| `limits` | object | ✓ |  |  |

---
*Generated from Zod schema. Do not edit directly.*
