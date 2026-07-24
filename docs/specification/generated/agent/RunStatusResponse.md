# RunStatusResponse

**Category:** agent

**Description:** Agent run status polling response

## JSON Schema

See [RunStatusResponse.json](../../../../packages/protocol/generated/json-schema/agent/RunStatusResponse.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

## Variants

### status = "accepted" | "running" | "awaiting_tool"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `agentRunId` | `string` | ✓ |  |
| `status` | `string` | ✓ | enum: `"accepted"`, `"running"`, `"awaiting_tool"` |

### status = "completed"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `agentRunId` | `string` | ✓ |  |
| `status` | `string` | ✓ | const: `"completed"` |
| `result` | `object` | ✓ |  |

#### result fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `financialSpread` | `object` | ✓ |  |
| `normalizedFacts` | `array` | ✓ |  |
| `risks` | `array` | ✓ |  |
| `discrepancies` | `array` | ✓ |  |
| `complianceFindings` | `array` | ✓ |  |
| `followUpRequests` | `array` | ✓ |  |
| `policyAssessment` | `object` | ✓ |  |
| `recommendation` | `object` | ✓ |  |
| `memo` | `object` | ✓ |  |
| `confidence` | `object` | ✓ |  |
| `usage` | `object` |  |  |

### status = "failed"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `agentRunId` | `string` | ✓ |  |
| `status` | `string` | ✓ | const: `"failed"` |
| `error` | `object` | ✓ |  |

#### error fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `code` | `string` | ✓ | enum: `"INVALID_SCHEMA_VERSION"`, `"UNKNOWN_BENCHMARK"`, `"LANE_NOT_SUPPORTED"`, `"CASE_NOT_FOUND"`, `"BUDGET_EXCEEDED"`, `"TOOL_ERROR"`, `"AGENT_TIMEOUT"`, `"AGENT_CRASHED"`, `"INVALID_SUBMISSION"`, `"RUN_NOT_FOUND"`, `"INVALID_RUN_STATE"` |
| `message` | `string` | ✓ |  |
| `details` | `object` |  |  |
| `requestId` | `string` | ✓ |  |

### status = "cancelled"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `agentRunId` | `string` | ✓ |  |
| `status` | `string` | ✓ | const: `"cancelled"` |

## Definitions

### __schema0

### __schema1

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `amount` | integer | ✓ |  |
| `currency` | [`__schema2`](#__schema2) | ✓ |  |

### __schema2

### __schema3

### __schema4

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `claim` | string | ✓ |  |
| `evidenceIds` | array | ✓ |  |
| `confidence` | number | ✓ |  |

### __schema5

---
*Generated from Zod schema. Do not edit directly.*
