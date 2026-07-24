# FinancialSpread

**Category:** submission

**Description:** Financial spread with period, currency, scale, and sign convention

## JSON Schema

See [FinancialSpread.json](../../json-schema/submission/FinancialSpread.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `revenue` | [`__schema0`](#__schema0) | ✓ |  |  |
| `cogs` | [`__schema0`](#__schema0) |  |  |  |
| `grossProfit` | [`__schema0`](#__schema0) |  |  |  |
| `operatingExpenses` | [`__schema0`](#__schema0) |  |  |  |
| `ebitda` | [`__schema0`](#__schema0) |  |  |  |
| `interestExpense` | [`__schema0`](#__schema0) |  |  |  |
| `taxes` | [`__schema0`](#__schema0) |  |  |  |
| `netIncome` | [`__schema0`](#__schema0) |  |  |  |
| `period` | object | ✓ |  |  |
| `currency` | [`__schema1`](#__schema1) | ✓ |  |  |
| `scale` | string | ✓ |  Default: `"units"` | enum: [units, thousands, millions, billions] |
| `signConvention` | string | ✓ |  Default: `"positive_revenue_negative_expense"` | enum: [positive_revenue_negative_expense, all_positive, all_negative] |

## Definitions

### __schema0

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `amount` | integer | ✓ |  |
| `currency` | [`__schema1`](#__schema1) | ✓ |  |

### __schema1

---
*Generated from Zod schema. Do not edit directly.*
