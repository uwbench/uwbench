# ProtocolError

**Category:** agent

**Description:** Protocol error response

## JSON Schema

See [ProtocolError.json](../../json-schema/agent/ProtocolError.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `schemaVersion` | string | ✓ |  |  |
| `code` | string | ✓ |  | enum: [INVALID_SCHEMA_VERSION, UNKNOWN_BENCHMARK, LANE_NOT_SUPPORTED, CASE_NOT_FOUND, BUDGET_EXCEEDED, TOOL_ERROR, AGENT_TIMEOUT, AGENT_CRASHED, INVALID_SUBMISSION, RUN_NOT_FOUND, INVALID_RUN_STATE] |
| `message` | string | ✓ |  |  |
| `details` | object |  |  |  |
| `requestId` | string | ✓ |  | minLength: 1 |

## Definitions

### __schema0

---
*Generated from Zod schema. Do not edit directly.*
