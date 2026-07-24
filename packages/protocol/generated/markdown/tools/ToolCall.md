# ToolCall

**Category:** tools

**Description:** Base tool call structure

## JSON Schema

See [ToolCall.json](../../json-schema/tools/ToolCall.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

## Variants

### name = "case.list_documents"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"case.list_documents"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

No fields.

### name = "case.get_document_metadata"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"case.get_document_metadata"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `documentId` | `string` | ✓ |  |

### name = "case.read_document"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"case.read_document"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `documentId` | `string` | ✓ |  |
| `pages` | `array` |  |  |

### name = "case.search_documents"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"case.search_documents"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `query` | `string` | ✓ |  |
| `limit` | `integer` |  |  |

### name = "case.get_structured_record"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"case.get_structured_record"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `recordId` | `string` | ✓ |  |

### name = "case.request_information"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"case.request_information"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `concept` | `string` | ✓ |  |
| `question` | `string` | ✓ |  |
| `context` | `string` |  |  |

### name = "policy.search"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"policy.search"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `query` | `string` | ✓ |  |
| `limit` | `integer` |  |  |

### name = "policy.get_rule"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"policy.get_rule"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `ruleId` | `string` | ✓ |  |

### name = "finance.calculate"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"finance.calculate"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `expression` | `string` | ✓ |  |
| `variables` | `object` | ✓ |  |

### name = "finance.calculate_ratios"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"finance.calculate_ratios"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `spread` | `__schema1` | ✓ |  |

### name = "finance.validate_spread"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"finance.validate_spread"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `spread` | `__schema1` | ✓ |  |

### name = "submission.save_artifact"

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `schemaVersion` | `__schema0` | ✓ |  |
| `callId` | `string` | ✓ |  |
| `name` | `string` | ✓ | const: `"submission.save_artifact"` |
| `arguments` | `object` | ✓ |  |

#### arguments fields

| Name | Type | Required | Constraint |
|------|------|----------|------------|
| `artifactId` | `string` | ✓ |  |
| `content` | `string` | ✓ |  |
| `contentType` | `string` | ✓ |  |

## Definitions

### __schema0

### __schema1

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `revenue` | [`__schema2`](#__schema2) | ✓ |  |
| `cogs` | [`__schema2`](#__schema2) |  |  |
| `grossProfit` | [`__schema2`](#__schema2) |  |  |
| `operatingExpenses` | [`__schema2`](#__schema2) |  |  |
| `ebitda` | [`__schema2`](#__schema2) |  |  |
| `interestExpense` | [`__schema2`](#__schema2) |  |  |
| `debtService` | [`__schema4`](#__schema4) |  |  |
| `totalDebt` | [`__schema4`](#__schema4) |  |  |
| `cash` | [`__schema4`](#__schema4) |  |  |
| `totalAssets` | [`__schema4`](#__schema4) |  |  |
| `totalLiabilities` | [`__schema4`](#__schema4) |  |  |
| `equity` | [`__schema2`](#__schema2) |  |  |
| `taxes` | [`__schema2`](#__schema2) |  |  |
| `netIncome` | [`__schema2`](#__schema2) |  |  |
| `period` | object | ✓ |  |
| `currency` | [`__schema3`](#__schema3) | ✓ |  |
| `scale` | string | ✓ |  |
| `signConvention` | string | ✓ |  |

### __schema2

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `amount` | integer | ✓ |  |
| `currency` | [`__schema3`](#__schema3) | ✓ |  |

### __schema3

### __schema4

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `amount` | integer | ✓ |  |
| `currency` | [`__schema3`](#__schema3) | ✓ |  |

---
*Generated from Zod schema. Do not edit directly.*
