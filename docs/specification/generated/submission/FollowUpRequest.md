# FollowUpRequest

**Category:** submission

**Description:** Follow-up information request with concept and status

## JSON Schema

See [FollowUpRequest.json](../json-schema/submission/FollowUpRequest.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `requestId` | string | ✓ |  |  |
| `concept` | string | ✓ |  |  |
| `status` | string | ✓ |  | enum: [PENDING, FULFILLED, NEEDS_CLARIFICATION, CANCELLED] |
| `response` | string |  |  |  |
| `revealedDocuments` | array<`string`> |  |  |  |

---
*Generated from Zod schema. Do not edit directly.*
