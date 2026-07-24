# Event

**Category:** events

**Description:** Event log entry with hash chain

## JSON Schema

See [Event.json](../../../../../packages/protocol/generated/json-schema/events/Event.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `schemaVersion` | string | ✓ |  |  |
| `eventId` | string | ✓ |  |  |
| `runId` | string | ✓ |  |  |
| `caseId` | string | ✓ |  |  |
| `sequence` | integer | ✓ |  | maximum: 9007199254740991<br>exclusiveMinimum: 0 |
| `timestamp` | string | ✓ |  | format: date-time<br>pattern: `^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$` |
| `source` | string | ✓ |  | enum: [RUNNER, AGENT, TOOL_GATEWAY, SCORER] |
| `type` | string | ✓ |  | enum: [RUN_STARTED, AGENT_READY, AGENT_RUN_STARTED, TOOL_CALL, TOOL_RESULT, TOOL_ERROR, ARTIFACT_SAVED, LIMIT_WARNING, AGENT_COMPLETED, AGENT_FAILED, RUN_CANCELLED, RUN_COMPLETED, SCORING_STARTED, SCORE_COMPONENT_CREATED, SCORING_COMPLETED] |
| `payload` | object | ✓ |  |  |
| `previousHash` | string | ✓ |  |  |
| `hash` | string | ✓ |  |  |

---
*Generated from Zod schema. Do not edit directly.*
