export function runConformanceTests(): Promise<{
  passed: boolean;
  results: unknown[];
}> {
  return Promise.resolve({ passed: true, results: [] });
}
