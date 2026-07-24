# ProtocolError

**Category:** agent

**Description:** Protocol error response

## JSON Schema

See [ProtocolError.json](../../../packages/protocol/generated/json-schema/agent/ProtocolError.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `code` | string | ✓ |  | enum: [INVALID_SCHEMA_VERSION, INVALID_RUN_REQUEST, RUN_NOT_FOUND, RUN_ALREADY_STARTED, RUN_NOT_RUNNABLE, INVALID_STATUS_TRANSITION, TOOL_CALL_FAILED, TOOL_TIMEOUT, BUDGET_EXCEEDED, INVALID_TOOL_CALL, UNAUTHORIZED, INTERNAL_ERROR] |
| `message` | string | ✓ |  |  |
| `details` | object |  |  |  |

---
*Generated from Zod schema. Do not edit directly.*
