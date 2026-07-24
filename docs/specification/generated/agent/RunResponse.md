# RunResponse

**Category:** agent

**Description:** Agent run initiation response

## JSON Schema

See [RunResponse.json](../json-schema/agent/RunResponse.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `agentRunId` | string | ✓ |  |  |
| `status` | string | ✓ |  | enum: [accepted, running, awaiting_tool, completed, failed, cancelled] |

---
*Generated from Zod schema. Do not edit directly.*
