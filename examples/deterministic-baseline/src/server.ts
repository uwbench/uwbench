import { DeterministicAgent, type AgentConfig } from "./agent.js";

async function main(): Promise<void> {
  const port = parseInt(process.env["PORT"] ?? "9090", 10);
  const behavior =
    (process.env["BEHAVIOR"] as AgentConfig["behavior"]) ?? "complete";
  const agent = new DeterministicAgent({ port, behavior });

  const shutdown = async (): Promise<void> => {
    await agent.stop();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  await agent.start();
  console.log(
    `[deterministic-baseline] Listening on http://localhost:${port} (${behavior})`,
  );
}

main().catch((err) => {
  console.error("[deterministic-baseline] Fatal error:", err);
  process.exit(1);
});
