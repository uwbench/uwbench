import { type FinancialSpread } from "@uwbench/protocol";
import type {
  SpreadValues,
  RatioCalculationResult,
  RatioDefinition,
  FinancialScorerConfig,
  FieldTolerance,
  ComparisonResult,
  FieldAlias,
} from "./types.js";

/**
 * Extract numeric amount from Money object
 */
function getAmount(
  money: { amount: number; currency: string } | undefined,
): number | null {
  return money?.amount ?? null;
}

/**
 * Flatten FinancialSpread into a record of field -> numeric value
 */
export function flattenSpread(spread: FinancialSpread): SpreadValues {
  return {
    revenue: getAmount(spread.revenue),
    cogs: getAmount(spread.cogs),
    grossProfit: getAmount(spread.grossProfit),
    operatingExpenses: getAmount(spread.operatingExpenses),
    ebitda: getAmount(spread.ebitda),
    interestExpense: getAmount(spread.interestExpense),
    debtService: getAmount(spread.debtService),
    totalDebt: getAmount(spread.totalDebt),
    cash: getAmount(spread.cash),
    currentAssets: getAmount(spread.currentAssets),
    currentLiabilities: getAmount(spread.currentLiabilities),
    totalAssets: getAmount(spread.totalAssets),
    totalLiabilities: getAmount(spread.totalLiabilities),
    equity: getAmount(spread.equity),
    taxes: getAmount(spread.taxes),
    netIncome: getAmount(spread.netIncome),
  };
}

/**
 * Get field value by dot-notation path (supports nested like period.start)
 * Also computes derived fields when base values are available
 */
export function getFieldValue(
  values: SpreadValues,
  path: string,
): number | null {
  // Handle direct field access (but don't return null for missing - compute instead)
  const directValue = values[path];
  if (directValue !== null && directValue !== undefined) {
    return directValue;
  }
  // Handle derived/computed fields
  switch (path) {
    case "grossProfit":
      if (values.revenue !== null && values.cogs !== null) {
        return values.revenue - values.cogs;
      }
      return values.grossProfit ?? null;
    case "operatingIncome":
      if (values.grossProfit !== null && values.operatingExpenses !== null) {
        return values.grossProfit - values.operatingExpenses;
      }
      return null;
    case "operatingMargin":
      if (
        values.grossProfit !== null &&
        values.operatingExpenses !== null &&
        values.revenue !== null
      ) {
        return (values.grossProfit - values.operatingExpenses) / values.revenue;
      }
      return null;
    default:
      return values[path] ?? null;
  }
}

/**
 * Calculate all ratios from spread values using provided definitions.
 * This is the INDEPENDENT RECALCULATION - does not trust submitted ratios.
 */
export function calculateRatiosFromSpread(
  spreadValues: SpreadValues,
  ratioDefinitions: RatioDefinition[],
): RatioCalculationResult {
  const ratios: Record<string, number> = {};
  const missingFields: string[] = [];
  const errors: string[] = [];

  for (const def of ratioDefinitions) {
    const numerator = getFieldValue(spreadValues, def.numerator);
    const denominator = getFieldValue(spreadValues, def.denominator);

    if (numerator === null) {
      missingFields.push(def.numerator);
      continue;
    }
    if (denominator === null) {
      missingFields.push(def.denominator);
      continue;
    }
    if (denominator === 0) {
      errors.push(
        `Division by zero for ratio ${def.name}: ${def.denominator} is zero`,
      );
      continue;
    }

    let value = numerator / denominator;
    if (def.isPercentage) {
      value *= 100;
    }
    ratios[def.name] = value;
  }

  return { ratios, missingFields: [...new Set(missingFields)], errors };
}

/**
 * Check if two numbers match within tolerance
 */
export function valuesMatch(
  a: number | null,
  b: number | null,
  tolerance: FieldTolerance = {},
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;

  const absoluteDiff = Math.abs(a - b);

  // If no tolerance specified, require exact match
  const hasAbsolute = tolerance.absolute !== undefined;
  const hasRelative = tolerance.relative !== undefined;
  const hasScale = tolerance.scale !== undefined;

  if (!hasAbsolute && !hasRelative && !hasScale) {
    return absoluteDiff === 0;
  }

  // Check absolute tolerance
  if (hasAbsolute && absoluteDiff <= (tolerance.absolute ?? 0)) {
    return true;
  }

  // Check relative tolerance
  if (hasRelative) {
    const denominator = Math.max(Math.abs(a), Math.abs(b), 1); // Avoid division by zero
    const relativeDiff = absoluteDiff / denominator;
    if (relativeDiff <= (tolerance.relative ?? 0)) {
      return true;
    }
  }

  // Check scale tolerance (for order-of-magnitude)
  if (hasScale) {
    const scaleDiff = Math.abs(
      Math.log10(Math.abs(a) || 1) - Math.log10(Math.abs(b) || 1),
    );
    if (scaleDiff <= (tolerance.scale ?? 0)) {
      return true;
    }
  }

  return false;
}

/**
 * Get effective tolerance for a field (field-specific or default)
 */
export function getEffectiveTolerance(
  fieldName: string,
  config: FinancialScorerConfig,
  isRatio = false,
): FieldTolerance {
  // Check ratio-specific tolerance first
  if (isRatio) {
    const ratioDef = config.ratios.find((r) => r.name === fieldName);
    if (ratioDef?.tolerance) return ratioDef.tolerance;
  }

  // Check field-specific tolerance
  const fieldConfig = config.fields.find((f) => f.field === fieldName);
  if (fieldConfig?.tolerance) return fieldConfig.tolerance;

  // Return default
  return config.defaultTolerance;
}

/**
 * Compare a single field: reported vs reference vs calculated
 */
export function compareField(
  name: string,
  reported: number | null,
  calculated: number | null,
  reference: number | null,
  config: FinancialScorerConfig,
  isRatio = false,
): ComparisonResult {
  const tolerance = getEffectiveTolerance(name, config, isRatio);
  const fieldConfig = config.fields.find((f) => f.field === name);
  const weight = fieldConfig?.weight ?? 1.0;

  const reportedMatchesReference = valuesMatch(reported, reference, tolerance);
  const calculatedMatchesReference = valuesMatch(
    calculated,
    reference,
    tolerance,
  );
  const reportedMatchesCalculated = valuesMatch(
    reported,
    calculated,
    tolerance,
  );

  const absoluteDiff =
    reported !== null && reference !== null
      ? Math.abs(reported - reference)
      : null;
  const relativeDiff =
    reported !== null && reference !== null && reference !== 0
      ? Math.abs(reported - reference) / Math.abs(reference)
      : null;

  // Score calculation:
  // - If reported matches reference: full weight
  // - Else if field missing in submission (reported null, reference not null): 0
  // - Else if calculated matches reference but reported doesn't: partial (agent calc error)
  // - Else if both wrong but consistent: minimal
  // - Else if both present but all differ: minimal
  // - Else (both null): 1.0 (not applicable)
  let score = 0;
  let detail: string | undefined;

  if (reportedMatchesReference) {
    score = 1.0;
    detail = "Reported value matches reference";
  } else if (reported === null && reference !== null) {
    score = 0.0;
    detail = "Field missing in submission";
  } else if (calculatedMatchesReference && !reportedMatchesCalculated) {
    score = 0.5;
    detail =
      "Calculated value matches reference but reported value differs (calculation error)";
  } else if (reportedMatchesCalculated && !calculatedMatchesReference) {
    score = 0.3;
    detail =
      "Reported matches calculated but both differ from reference (input error)";
  } else if (reported !== null && reference !== null) {
    score = 0.1;
    detail =
      "Both reported and calculated differ from reference and each other";
  } else {
    score = 1.0; // Both null - not applicable
    detail = "Field not present in either submission or reference";
  }

  return {
    name,
    reported,
    calculated,
    reference,
    reportedMatchesReference,
    calculatedMatchesReference,
    reportedMatchesCalculated,
    absoluteDiff,
    relativeDiff,
    toleranceUsed: tolerance,
    weight,
    score: Math.min(Math.max(score, 0), 1),
    detail,
  };
}

/**
 * Apply field aliases to normalize submitted spread field names
 */
export function applyAliases(
  submittedSpread: Record<string, unknown>,
  aliases: FieldAlias[],
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...submittedSpread };

  for (const alias of aliases) {
    for (const alt of alias.aliases) {
      if (alt in normalized && !(alias.canonical in normalized)) {
        normalized[alias.canonical] = normalized[alt];
      }
    }
  }

  return normalized;
}

/**
 * Convert flattened spread values back to FinancialSpread shape for comparison
 */
export function spreadValuesToComparable(
  spread: FinancialSpread,
): SpreadValues {
  return flattenSpread(spread);
}
