# Money

**Category:** submission

**Description:** Monetary amount in minor units with ISO 4217 currency

## JSON Schema

See [Money.json](../json-schema/submission/Money.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `amount` | integer | ✓ |  | minimum: -9007199254740991<br>maximum: 9007199254740991 |
| `currency` | string | ✓ |  | minLength: 3<br>maxLength: 3 |

---
*Generated from Zod schema. Do not edit directly.*
