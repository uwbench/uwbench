/**
 * @uwbench/report — Score aggregation, safety caps, and static report generation
 *
 * Aggregates deterministic score components from all scorers,
 * enforces safety caps, and publishes JSON and HTML reports
 * with exact scorer versions and audit trails.
 */

export * from "./types.js";
export * from "./aggregate.js";
export * from "./html.js";

export { REPORT_VERSION } from "./html.js";
