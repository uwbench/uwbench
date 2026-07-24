# RunStatusResponse

**Category:** agent

**Description:** Agent run status polling response

## JSON Schema

See [RunStatusResponse.json](../json-schema/agent/RunStatusResponse.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `agentRunId` | string | ✓ |  |  |
| `status` | string | ✓ |  | enum: [accepted, running, awaiting_tool, completed, failed, cancelled] |
| `result` | object |  |  |  |
| `error` | string |  |  |  |

---
*Generated from Zod schema. Do not edit directly.*
