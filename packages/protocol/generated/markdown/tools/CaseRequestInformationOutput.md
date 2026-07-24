# CaseRequestInformationOutput

**Category:** tools

**Description:** Output for case.request_information

## JSON Schema

See [CaseRequestInformationOutput.json](../../json-schema/tools/CaseRequestInformationOutput.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `status` | string | ✓ |  | enum: [AVAILABLE, ALREADY_PROVIDED, NEEDS_CLARIFICATION] |
| `revealedDocumentIds` | array<`string`> |  |  |  |
| `clarification` | string |  |  |  |

---
*Generated from Zod schema. Do not edit directly.*
