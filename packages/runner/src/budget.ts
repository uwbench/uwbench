export interface Budget {
  wallClockSeconds: number;
  maxToolCalls: number;
  maxOutputBytes: number;
  maxConcurrentToolCalls: number;
}

export function enforceBudget(_budget: Budget): void {
  // placeholder
}
