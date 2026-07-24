# CancelResponse

**Category:** agent

**Description:** Agent run cancellation response

## JSON Schema

See [CancelResponse.json](../../../packages/protocol/generated/json-schema/agent/CancelResponse.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `agentRunId` | string | ✓ |  |  |
| `status` | string | ✓ |  | enum: [accepted, running, awaiting_tool, completed, failed, cancelled] |

---
*Generated from Zod schema. Do not edit directly.*
