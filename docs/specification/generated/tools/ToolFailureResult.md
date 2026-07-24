# ToolFailureResult

**Category:** tools

**Description:** Failed tool result

## JSON Schema

See [ToolFailureResult.json](../../../../packages/protocol/generated/json-schema/tools/ToolFailureResult.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `schemaVersion` | string | ✓ |  |  |
| `callId` | string | ✓ |  | minLength: 1 |
| `ok` | boolean | ✓ |  |  |
| `name` | string | ✓ |  | enum: [case.list_documents, case.get_document_metadata, case.read_document, case.search_documents, case.get_structured_record, case.request_information, policy.search, policy.get_rule, finance.calculate, finance.calculate_ratios, finance.validate_spread, submission.save_artifact] |
| `error` | object | ✓ |  |  |

## Definitions

### __schema0

---
*Generated from Zod schema. Do not edit directly.*
