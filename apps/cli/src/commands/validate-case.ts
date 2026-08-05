import { Command } from "commander";
import {
  validateCase,
  validateCaseSync,
  type ValidationResult,
} from "@uwbench/case-schema";

export const validateCaseCommand = new Command("validate-case")
  .description("Validate a case directory against the case schema")
  .argument("<path>", "Path to case directory")
  .option("--sync", "Use synchronous validation")
  .option("--json", "Output results as JSON")
  .option("--verbose", "Show detailed diagnostics")
  .action(async (casePath: string, options) => {
    const isJson = options.json === true;
    if (!isJson) console.log(`Validating case at ${casePath}...`);

    try {
      let result: ValidationResult;
      if (options.sync) {
        result = validateCaseSync(casePath);
      } else {
        result = await validateCase(casePath);
      }

      if (isJson) {
        console.log(
          JSON.stringify(
            {
              success: result.success,
              diagnostics: result.diagnostics,
              case: result.case
                ? {
                    case_id: result.case.case_id,
                    track: result.case.track,
                    benchmark_version: result.case.benchmark_version,
                    supported_lanes: result.case.supported_lanes,
                  }
                : undefined,
            },
            null,
            2,
          ),
        );
      } else {
        printResults(result, options.verbose);
      }

      if (!result.success) {
        if (!isJson) console.error("\n❌ Case validation FAILED");
        process.exitCode = 1;
      } else {
        if (!isJson) console.log("\n✅ Case validation PASSED");
        process.exitCode = 0;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isJson) {
        console.log(
          JSON.stringify({ success: false, error: message }, null, 2),
        );
      } else {
        console.error(`Failed to validate case: ${message}`);
      }
      process.exitCode = 1;
    }
  });

function printResults(result: ValidationResult, verbose: boolean): void {
  if (result.case) {
    console.log(`\nCase: ${result.case.case_id}`);
    console.log(`Track: ${result.case.track}`);
    console.log(`Benchmark Version: ${result.case.benchmark_version}`);
    console.log(`Supported Lanes: ${result.case.supported_lanes.join(", ")}`);
  }

  if (result.diagnostics.length === 0) {
    console.log("\nNo issues found.");
    return;
  }

  console.log(`\nDiagnostics (${result.diagnostics.length}):\n`);

  for (const diag of result.diagnostics) {
    const prefix = result.success ? "⚠️ " : "❌ ";
    console.log(`  ${prefix}[${diag.code}] ${diag.message}`);
    console.log(`      Location: ${diag.location}`);
    if (diag.context && (verbose || !result.success)) {
      console.log(`      Context: ${JSON.stringify(diag.context, null, 6)}`);
    }
  }

  console.log();
}
