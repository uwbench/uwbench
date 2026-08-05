import type { FinancialSpread } from "@uwbench/protocol";

type Token =
  | { kind: "number"; value: number }
  | { kind: "identifier"; value: string }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" }
  | { kind: "left" }
  | { kind: "right" };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < expression.length) {
    const remainder = expression.slice(offset);
    const whitespace = /^\s+/.exec(remainder);
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(remainder);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      offset += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(remainder);
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0] });
      offset += identifier[0].length;
      continue;
    }
    const character = expression[offset];
    if (
      character === "+" ||
      character === "-" ||
      character === "*" ||
      character === "/"
    ) {
      tokens.push({ kind: "operator", value: character });
      offset += 1;
      continue;
    }
    if (character === "(") {
      tokens.push({ kind: "left" });
      offset += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ kind: "right" });
      offset += 1;
      continue;
    }
    throw new Error(`Unexpected token at character ${offset + 1}`);
  }
  if (tokens.length === 0) throw new Error("Expression is empty");
  return tokens;
}

class ArithmeticParser {
  private offset = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly variables: Record<string, number>,
  ) {}

  parse(): number {
    const result = this.parseSum();
    if (this.offset !== this.tokens.length) {
      throw new Error("Unexpected trailing expression");
    }
    if (!Number.isFinite(result)) {
      throw new Error("Expression did not produce a finite number");
    }
    return result;
  }

  private parseSum(): number {
    let value = this.parseProduct();
    while (true) {
      const token = this.tokens[this.offset];
      if (
        token?.kind !== "operator" ||
        (token.value !== "+" && token.value !== "-")
      ) {
        return value;
      }
      this.offset += 1;
      const right = this.parseProduct();
      value = token.value === "+" ? value + right : value - right;
    }
  }

  private parseProduct(): number {
    let value = this.parseUnary();
    while (true) {
      const token = this.tokens[this.offset];
      if (
        token?.kind !== "operator" ||
        (token.value !== "*" && token.value !== "/")
      ) {
        return value;
      }
      this.offset += 1;
      const right = this.parseUnary();
      if (token.value === "/" && right === 0)
        throw new Error("Division by zero");
      value = token.value === "*" ? value * right : value / right;
    }
  }

  private parseUnary(): number {
    const token = this.tokens[this.offset];
    if (
      token?.kind === "operator" &&
      (token.value === "+" || token.value === "-")
    ) {
      this.offset += 1;
      const value = this.parseUnary();
      return token.value === "-" ? -value : value;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.tokens[this.offset];
    if (!token) throw new Error("Expression ended unexpectedly");
    this.offset += 1;
    if (token.kind === "number") return token.value;
    if (token.kind === "identifier") {
      const value = this.variables[token.value];
      if (value === undefined)
        throw new Error(`Unknown variable: ${token.value}`);
      if (!Number.isFinite(value))
        throw new Error(`Variable is not finite: ${token.value}`);
      return value;
    }
    if (token.kind === "left") {
      const value = this.parseSum();
      if (this.tokens[this.offset]?.kind !== "right") {
        throw new Error("Missing closing parenthesis");
      }
      this.offset += 1;
      return value;
    }
    throw new Error("Expected a number, variable, or parenthesized expression");
  }
}

export function calculate(
  expression: string,
  variables: Record<string, number>,
): number {
  return new ArithmeticParser(tokenize(expression), variables).parse();
}

function amount(
  money: { amount: number; currency: string } | undefined,
): number | undefined {
  return money?.amount;
}

function setRatio(
  ratios: Record<string, number>,
  name: string,
  numerator: number | undefined,
  denominator: number | undefined,
): void {
  if (
    numerator !== undefined &&
    denominator !== undefined &&
    denominator !== 0
  ) {
    ratios[name] = numerator / denominator;
  }
}

export function calculateRatios(
  spread: FinancialSpread,
): Record<string, number> {
  const ratios: Record<string, number> = {};
  const revenue = amount(spread.revenue);
  const grossProfit = amount(spread.grossProfit);
  const operatingExpenses = amount(spread.operatingExpenses);
  const ebitda = amount(spread.ebitda);
  const interestExpense = amount(spread.interestExpense);
  const debtService = amount(spread.debtService);
  const totalDebt = amount(spread.totalDebt);
  const currentAssets = amount(spread.currentAssets);
  const currentLiabilities = amount(spread.currentLiabilities);
  const totalAssets = amount(spread.totalAssets);
  const equity = amount(spread.equity);
  const netIncome = amount(spread.netIncome);

  setRatio(ratios, "gross_margin", grossProfit, revenue);
  setRatio(ratios, "ebitda_margin", ebitda, revenue);
  setRatio(ratios, "net_margin", netIncome, revenue);
  setRatio(ratios, "dscr", ebitda, debtService);
  setRatio(ratios, "interest_coverage", ebitda, interestExpense);
  setRatio(ratios, "total_debt_to_ebitda", totalDebt, ebitda);
  setRatio(ratios, "debt_to_equity", totalDebt, equity);
  setRatio(ratios, "current_ratio", currentAssets, currentLiabilities);
  setRatio(ratios, "leverage_ratio", totalDebt, ebitda);
  setRatio(ratios, "equity_to_assets", equity, totalAssets);
  setRatio(ratios, "return_on_assets", netIncome, totalAssets);
  setRatio(ratios, "return_on_equity", netIncome, equity);
  setRatio(ratios, "asset_turnover", revenue, totalAssets);
  if (grossProfit !== undefined && operatingExpenses !== undefined) {
    setRatio(
      ratios,
      "operating_margin",
      grossProfit - operatingExpenses,
      revenue,
    );
  }
  return ratios;
}

function currencyErrors(spread: FinancialSpread): string[] {
  const currencies = new Set(
    [
      spread.revenue,
      spread.cogs,
      spread.grossProfit,
      spread.operatingExpenses,
      spread.ebitda,
      spread.interestExpense,
      spread.debtService,
      spread.totalDebt,
      spread.cash,
      spread.currentAssets,
      spread.currentLiabilities,
      spread.totalAssets,
      spread.totalLiabilities,
      spread.equity,
      spread.taxes,
      spread.netIncome,
    ].flatMap((money) => (money ? [money.currency] : [])),
  );
  if (
    currencies.size > 1 ||
    (currencies.size === 1 && !currencies.has(spread.currency))
  ) {
    return [
      `Money currencies must all match spread currency ${spread.currency}`,
    ];
  }
  return [];
}

export function validateSpread(spread: FinancialSpread): {
  valid: boolean;
  errors?: string[];
} {
  const errors = currencyErrors(spread);
  const revenue = amount(spread.revenue);
  const cogs = amount(spread.cogs);
  const grossProfit = amount(spread.grossProfit);
  const operatingExpenses = amount(spread.operatingExpenses);
  const ebitda = amount(spread.ebitda);
  const interestExpense = amount(spread.interestExpense);
  const taxes = amount(spread.taxes);
  const netIncome = amount(spread.netIncome);
  const totalAssets = amount(spread.totalAssets);
  const totalLiabilities = amount(spread.totalLiabilities);
  const equity = amount(spread.equity);

  if (
    revenue !== undefined &&
    cogs !== undefined &&
    grossProfit !== undefined &&
    grossProfit !== revenue - cogs
  ) {
    errors.push("grossProfit must equal revenue minus cogs");
  }
  if (
    grossProfit !== undefined &&
    operatingExpenses !== undefined &&
    ebitda !== undefined &&
    ebitda !== grossProfit - operatingExpenses
  ) {
    errors.push("ebitda must equal grossProfit minus operatingExpenses");
  }
  if (
    ebitda !== undefined &&
    interestExpense !== undefined &&
    taxes !== undefined &&
    netIncome !== undefined &&
    netIncome !== ebitda - interestExpense - taxes
  ) {
    errors.push("netIncome must equal ebitda minus interestExpense and taxes");
  }
  if (
    totalAssets !== undefined &&
    totalLiabilities !== undefined &&
    equity !== undefined &&
    totalAssets !== totalLiabilities + equity
  ) {
    errors.push("totalAssets must equal totalLiabilities plus equity");
  }
  if (spread.period.start >= spread.period.end) {
    errors.push("period.start must be earlier than period.end");
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
