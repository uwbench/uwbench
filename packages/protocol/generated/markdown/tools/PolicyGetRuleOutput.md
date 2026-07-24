# PolicyGetRuleOutput

**Category:** tools

**Description:** Output for policy.get_rule

## JSON Schema

See [PolicyGetRuleOutput.json](../../json-schema/tools/PolicyGetRuleOutput.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `ruleId` | string | ✓ |  |  |
| `sourceId` | string | ✓ |  |  |
| `title` | string | ✓ |  |  |
| `appliesWhen` | string | ✓ |  |  |
| `input` | object | ✓ |  |  |
| `operator` | string | ✓ |  |  |
| `threshold` | object | ✓ |  |  |
| `onFailure` | string | ✓ |  |  |
| `citationAnchors` | array<`object`> | ✓ |  |  |

---
*Generated from Zod schema. Do not edit directly.*
