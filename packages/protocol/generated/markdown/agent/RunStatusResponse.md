# RunStatusResponse

**Category:** agent

**Description:** Agent run status polling response

## JSON Schema

See [RunStatusResponse.json](../../../packages/protocol/generated/json-schema/agent/RunStatusResponse.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `agentRunId` | string | ✓ |  |  |
| `status` | string | ✓ |  | enum: [accepted, running, awaiting_tool, completed, failed, cancelled] |
| `result` | object |  |  |  |
| `error` | string |  |  |  |

## Definitions

### __schema0

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `amount` | integer | ✓ |  |
| `currency` | [`__schema1`](../../../packages/protocol/generated/json-schema/#/$defs/__schema1) | ✓ |  |

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
