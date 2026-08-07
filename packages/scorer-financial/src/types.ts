import { z } from "zod";
import type { FinancialSpread } from "@uwbench/protocol";

/**
 * Financial Scorer Contracts
 *
 * Implements deterministic scoring for submitted financial spreads and calculated ratios.
 * Per-field tolerances, aliases, and reported-vs-calculated comparisons.
 * Independent ratio recalculation from submitted spread inputs.
 */

// ──────────────────────────────────────────────────────────────
// Scorer Version
// ──────────────────────────────────────────────────────────────

export const FINANCIAL_SCORER_VERSION = "0.1.0" as const;

export const FinancialScorerVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export type FinancialScorerVersion = z.infer<
  typeof FinancialScorerVersionSchema
>;

// ──────────────────────────────────────────────────────────────
// Tolerance and Field Configuration
// ──────────────────────────────────────────────────────────────

export const FieldToleranceSchema = z.strictObject({
  /** Absolute tolerance (e.g., ±$1000) */
  absolute: z.number().nonnegative().optional(),
  /** Relative tolerance as fraction (e.g., 0.01 = 1%) */
  relative: z.number().min(0).max(1).optional(),
  /** Scale tolerance for magnitude differences */
  scale: z.number().nonnegative().optional(),
});
export type FieldTolerance = z.infer<typeof FieldToleranceSchema>;

export const FieldAliasSchema = z.strictObject({
  /** Canonical field name in FinancialSpread */
  canonical: z.string(),
  /** Alternative names that map to canonical */
  aliases: z.array(z.string()),
});
export type FieldAlias = z.infer<typeof FieldAliasSchema>;

export const RatioDefinitionSchema = z.strictObject({
  /** Ratio name (matches calculated ratio key) */
  name: z.string(),
  /** Numerator field path (e.g., "ebitda") */
  numerator: z.string(),
  /** Denominator field path (e.g., "debtService") */
  denominator: z.string(),
  /** Whether ratio is a percentage (multiplied by 100) */
  isPercentage: z.boolean().default(false),
  /** Field-specific tolerance override */
  tolerance: FieldToleranceSchema.optional(),
});
export type RatioDefinition = z.infer<typeof RatioDefinitionSchema>;

export const SpreadFieldConfigSchema = z.strictObject({
  /** Field path in FinancialSpread (dot notation for nested) */
  field: z.string(),
  /** Human-readable label */
  label: z.string(),
  /** Field tolerance (overrides global if present) */
  tolerance: FieldToleranceSchema.optional(),
  /** Whether this field is required for scoring */
  required: z.boolean().default(true),
  /** Weight for this field in overall score (0-1) */
  weight: z.number().min(0).max(1).default(1),
});
export type SpreadFieldConfig = z.infer<typeof SpreadFieldConfigSchema>;

export const FinancialScorerConfigSchema = z.strictObject({
  /** Global default tolerance for all fields */
  defaultTolerance: FieldToleranceSchema.default({
    absolute: 0,
    relative: 0.001,
  }),
  /** Per-field configuration */
  fields: z.array(SpreadFieldConfigSchema),
  /** Ratio definitions for independent recalculation */
  ratios: z.array(RatioDefinitionSchema),
  /** Field aliases for mapping submitted field names */
  aliases: z.array(FieldAliasSchema).default([]),
  /** Minimum score floor (0-1) */
  floor: z.number().min(0).max(1).default(0),
  /** Maximum score ceiling (0-1) */
  ceiling: z.number().min(0).max(1).default(1),
});
export type FinancialScorerConfig = z.infer<typeof FinancialScorerConfigSchema>;

// ──────────────────────────────────────────────────────────────
// Comparison Results
// ──────────────────────────────────────────────────────────────

export const ComparisonResultSchema = z.strictObject({
  /** Field or ratio name */
  name: z.string(),
  /** Submitted/reported value */
  reported: z.number().nullable(),
  /** Independently calculated/expected value */
  calculated: z.number().nullable(),
  /** Reference/ground truth value */
  reference: z.number().nullable(),
  /** Whether reported matches reference within tolerance */
  reportedMatchesReference: z.boolean(),
  /** Whether calculated matches reference within tolerance */
  calculatedMatchesReference: z.boolean(),
  /** Whether reported matches calculated (self-consistency) */
  reportedMatchesCalculated: z.boolean(),
  /** Absolute difference between reported and reference */
  absoluteDiff: z.number().nullable(),
  /** Relative difference between reported and reference */
  relativeDiff: z.number().nullable(),
  /** Field-specific tolerance used */
  toleranceUsed: FieldToleranceSchema,
  /** Weight of this field in score */
  weight: z.number(),
  /** Score contribution (0-1) */
  score: z.number().min(0).max(1),
  /** Details for debugging */
  detail: z.string().optional(),
});
export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;

// ──────────────────────────────────────────────────────────────
// Financial Score Component
// ──────────────────────────────────────────────────────────────

export const FinancialScoreComponentSchema = z.strictObject({
  /** Component identifier */
  component: z.literal("financial_spread"),
  /** Scorer version that produced this score */
  scorerVersion: FinancialScorerVersionSchema,
  /** Overall financial score (0-1) */
  score: z.number().min(0).max(1),
  /** Raw count of fields compared */
  fieldsTotal: z.number().int().nonnegative(),
  /** Count of fields where reported matches reference */
  fieldsMatchingReference: z.number().int().nonnegative(),
  /** Count of fields where calculated matches reference */
  ratiosMatchingReference: z.number().int().nonnegative(),
  /** Count of fields where reported matches calculated */
  selfConsistent: z.number().int().nonnegative(),
  /** Per-field comparison details */
  fieldComparisons: z.array(ComparisonResultSchema),
  /** Per-ratio comparison details */
  ratioComparisons: z.array(ComparisonResultSchema),
  /** Summary for reporting */
  summary: z.strictObject({
    spreadAccuracy: z.number().min(0).max(1),
    ratioAccuracy: z.number().min(0).max(1),
    selfConsistency: z.number().min(0).max(1),
  }),
  /** Timestamp when score was generated */
  scoredAt: z.string().datetime(),
});
export type FinancialScoreComponent = z.infer<
  typeof FinancialScoreComponentSchema
>;

// ──────────────────────────────────────────────────────────────
// Input for Scoring
// ──────────────────────────────────────────────────────────────

export const FinancialScoreInputSchema = z.strictObject({
  /** Submitted financial spread from agent */
  submittedSpread: z.custom<FinancialSpread>(),
  /** Reference/expected financial spread */
  referenceSpread: z.custom<FinancialSpread>(),
  /** Reference calculated ratios (from private reference package) */
  referenceRatios: z.record(z.string(), z.number()),
  /** Scorer configuration */
  config: FinancialScorerConfigSchema,
  /** Case ID for traceability */
  caseId: z.string().min(1),
  /** Run ID for traceability */
  runId: z.string().min(1),
});
export type FinancialScoreInput = z.infer<typeof FinancialScoreInputSchema>;

// ──────────────────────────────────────────────────────────────
// Default Configuration
// ──────────────────────────────────────────────────────────────

/**
 * Default field configuration for commercial credit spreads.
 * Covers all fields in FinancialSpreadSchema plus common aliases.
 */
export const DEFAULT_SPREAD_FIELDS: SpreadFieldConfig[] = [
  { field: "revenue", label: "Revenue", required: true, weight: 1.0 },
  { field: "cogs", label: "COGS", required: false, weight: 0.8 },
  { field: "grossProfit", label: "Gross Profit", required: false, weight: 0.8 },
  {
    field: "operatingExpenses",
    label: "Operating Expenses",
    required: false,
    weight: 0.8,
  },
  { field: "ebitda", label: "EBITDA", required: true, weight: 1.0 },
  {
    field: "interestExpense",
    label: "Interest Expense",
    required: false,
    weight: 0.8,
  },
  { field: "debtService", label: "Debt Service", required: true, weight: 1.0 },
  { field: "totalDebt", label: "Total Debt", required: true, weight: 1.0 },
  { field: "cash", label: "Cash", required: false, weight: 0.5 },
  {
    field: "currentAssets",
    label: "Current Assets",
    required: true,
    weight: 0.8,
  },
  {
    field: "currentLiabilities",
    label: "Current Liabilities",
    required: true,
    weight: 0.8,
  },
  { field: "totalAssets", label: "Total Assets", required: true, weight: 0.8 },
  {
    field: "totalLiabilities",
    label: "Total Liabilities",
    required: false,
    weight: 0.5,
  },
  { field: "equity", label: "Equity", required: true, weight: 1.0 },
  { field: "taxes", label: "Taxes", required: false, weight: 0.5 },
  { field: "netIncome", label: "Net Income", required: false, weight: 0.8 },
];

/**
 * Default ratio definitions matching finance.calculateRatios in tool-runtime.
 */
export const DEFAULT_RATIO_DEFINITIONS: RatioDefinition[] = [
  {
    name: "gross_margin",
    numerator: "grossProfit",
    denominator: "revenue",
    isPercentage: true,
  },
  {
    name: "ebitda_margin",
    numerator: "ebitda",
    denominator: "revenue",
    isPercentage: true,
  },
  {
    name: "net_margin",
    numerator: "netIncome",
    denominator: "revenue",
    isPercentage: true,
  },
  {
    name: "operating_margin",
    numerator: "operatingIncome",
    denominator: "revenue",
    isPercentage: true,
    tolerance: { relative: 0.005 },
  },
  {
    name: "dscr",
    numerator: "ebitda",
    denominator: "debtService",
    isPercentage: false,
  },
  {
    name: "interest_coverage",
    numerator: "ebitda",
    denominator: "interestExpense",
    isPercentage: false,
  },
  {
    name: "total_debt_to_ebitda",
    numerator: "totalDebt",
    denominator: "ebitda",
    isPercentage: false,
  },
  {
    name: "debt_to_equity",
    numerator: "totalDebt",
    denominator: "equity",
    isPercentage: false,
  },
  {
    name: "current_ratio",
    numerator: "currentAssets",
    denominator: "currentLiabilities",
    isPercentage: false,
  },
  {
    name: "leverage_ratio",
    numerator: "totalDebt",
    denominator: "ebitda",
    isPercentage: false,
  },
  {
    name: "equity_to_assets",
    numerator: "equity",
    denominator: "totalAssets",
    isPercentage: true,
  },
  {
    name: "return_on_assets",
    numerator: "netIncome",
    denominator: "totalAssets",
    isPercentage: true,
  },
  {
    name: "return_on_equity",
    numerator: "netIncome",
    denominator: "equity",
    isPercentage: true,
  },
  {
    name: "asset_turnover",
    numerator: "revenue",
    denominator: "totalAssets",
    isPercentage: false,
  },
];

/**
 * Default field aliases for common naming variations.
 */
export const DEFAULT_FIELD_ALIASES: FieldAlias[] = [
  {
    canonical: "revenue",
    aliases: ["sales", "turnover", "total_revenue", "net_sales"],
  },
  {
    canonical: "cogs",
    aliases: ["cost_of_goods_sold", "cost_of_sales", "cogs"],
  },
  { canonical: "grossProfit", aliases: ["gross_profit", "gross_income"] },
  {
    canonical: "operatingExpenses",
    aliases: ["opex", "operating_expenses", "sg_and_a"],
  },
  {
    canonical: "ebitda",
    aliases: ["ebitda", "operating_income_before_depreciation"],
  },
  {
    canonical: "interestExpense",
    aliases: ["interest_expense", "interest_cost", "financial_expense"],
  },
  {
    canonical: "debtService",
    aliases: ["debt_service", "total_debt_service", "annual_debt_service"],
  },
  {
    canonical: "totalDebt",
    aliases: ["total_debt", "total_liabilities", "gross_debt"],
  },
  { canonical: "cash", aliases: ["cash_and_equivalents", "cash_on_hand"] },
  {
    canonical: "currentAssets",
    aliases: ["current_assets", "short_term_assets"],
  },
  {
    canonical: "currentLiabilities",
    aliases: ["current_liabilities", "short_term_liabilities"],
  },
  { canonical: "totalAssets", aliases: ["total_assets", "assets"] },
  {
    canonical: "totalLiabilities",
    aliases: ["total_liabilities", "liabilities"],
  },
  {
    canonical: "equity",
    aliases: ["shareholders_equity", "owners_equity", "net_worth"],
  },
  {
    canonical: "taxes",
    aliases: ["tax_expense", "income_tax", "provision_for_taxes"],
  },
  {
    canonical: "netIncome",
    aliases: ["net_income", "net_profit", "profit_after_tax", "earnings"],
  },
];

/**
 * Creates default scorer configuration.
 */
export function createDefaultFinancialScorerConfig(): FinancialScorerConfig {
  return {
    defaultTolerance: { absolute: 0, relative: 0.001 },
    fields: DEFAULT_SPREAD_FIELDS,
    ratios: DEFAULT_RATIO_DEFINITIONS,
    aliases: DEFAULT_FIELD_ALIASES,
    floor: 0,
    ceiling: 1,
  };
}

// ──────────────────────────────────────────────────────────────
// Helper Types
// ──────────────────────────────────────────────────────────────

/**
 * Flat representation of FinancialSpread for easy field access.
 * Uses explicit known fields plus index signature for dynamic access.
 */
export interface SpreadValues {
  revenue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  operatingExpenses: number | null;
  ebitda: number | null;
  interestExpense: number | null;
  debtService: number | null;
  totalDebt: number | null;
  cash: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  taxes: number | null;
  netIncome: number | null;
  [key: string]: number | null;
}

export interface RatioCalculationResult {
  ratios: Record<string, number>;
  missingFields: string[];
  errors: string[];
}
