# NormalizedFact

**Category:** submission

**Description:** Normalized fact with canonical key, value, evidence, and confidence

## JSON Schema

See [NormalizedFact.json](../../json-schema/submission/NormalizedFact.json) for the canonical JSON Schema (OpenAPI 3.1 compatible).

**Type:** `object`

## Properties

| Name | Type | Required | Description | Constraints |
|------|------|----------|-------------|-------------|
| `canonicalKey` | string | ✓ |  |  |
| `value` | [`__schema0`](#__schema0) | ✓ |  |  |
| `normalizedValue` | [`__schema1`](#__schema1) |  |  |  |
| `type` | string | ✓ |  |  |
| `unit` | string |  |  |  |
| `currency` | string |  |  | enum: [AED, AFN, ALL, AMD, ANG, AOA, ARS, AUD, AWG, AZN, BAM, BBD, BDT, BGN, BHD, BIF, BMD, BND, BOB, BOV, BRL, BSD, BTN, BWP, BYN, BZD, CAD, CDF, CHE, CHF, CHW, CLF, CLP, CNY, COP, COU, CRC, CUP, CVE, CZK, DJF, DKK, DOP, DZD, EGP, ERN, ETB, EUR, FJD, FKP, GBP, GEL, GHS, GIP, GMD, GNF, GTQ, GYD, HKD, HNL, HTG, HUF, IDR, ILS, INR, IQD, IRR, ISK, JMD, JOD, JPY, KES, KGS, KHR, KMF, KPW, KRW, KWD, KYD, KZT, LAK, LBP, LKR, LRD, LSL, LYD, MAD, MDL, MGA, MKD, MMK, MNT, MOP, MRU, MUR, MVR, MWK, MXN, MXV, MYR, MZN, NAD, NGN, NIO, NOK, NPR, NZD, OMR, PAB, PEN, PGK, PHP, PKR, PLN, PYG, QAR, RON, RSD, RUB, RWF, SAR, SBD, SCR, SDG, SEK, SGD, SHP, SLE, SOS, SRD, SSP, STN, SVC, SYP, SZL, THB, TJS, TMT, TND, TOP, TRY, TTD, TWD, TZS, UAH, UGX, USD, USN, UYI, UYU, UYW, UZS, VES, VND, VUV, WST, XAF, XAG, XAU, XBA, XBB, XBC, XBD, XCD, XCG, XDR, XOF, XPD, XPF, XPT, XSU, XTS, XXX, YER, ZAR, ZMW, ZWG] |
| `scale` | integer |  |  | minimum: -9007199254740991<br>maximum: 9007199254740991 |
| `period` | object |  |  |  |
| `evidence` | array<`__schema2`> | ✓ |  |  |
| `confidence` | number |  |  | minimum: 0<br>maximum: 1 |
| `conflictGroup` | string |  |  |  |

## Definitions

### __schema0

### __schema1

### __schema2

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sourceId` | string | ✓ |  |
| `documentId` | string |  |  |
| `page` | integer |  |  |
| `startOffset` | integer |  |  |
| `endOffset` | integer |  |  |

---
*Generated from Zod schema. Do not edit directly.*
