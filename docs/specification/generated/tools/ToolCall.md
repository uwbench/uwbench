# ToolCall

**Category:** tools

**Description:** Base tool call structure

## JSON Schema

See [ToolCall.json](../json-schema/tools/ToolCall.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `callId` | string | ✓ |  | minLength: 1 |
| `name` | string | ✓ |  | minLength: 1 |
| `arguments` | object | ✓ |  |  |

---
*Generated from Zod schema. Do not edit directly.*
