import { OracleInputAgent, type AgentConfig } from "./agent.js";

async function main(): Promise<void> {
  const port = parseInt(process.env["PORT"] ?? "9090", 10);
  const behavior =
    (process.env["BEHAVIOR"] as AgentConfig["behavior"]) ?? "complete";
  const real = process.env["REAL"] === "true";
  const agent = new OracleInputAgent({ port, behavior, real });

  const shutdown = async (): Promise<void> => {
    await agent.stop();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  await agent.start();
  console.log(
    `[oracle-input-baseline] Listening on http://localhost:${port} (${real ? "real" : behavior})`,
  );
}

main().catch((err) => {
  console.error("[oracle-input-baseline] Fatal error:", err);
  process.exit(1);
});
