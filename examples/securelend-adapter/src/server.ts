import process from "node:process";
import { SecureLendAdapter } from "./adapter.js";
import { readAdapterConfig } from "./identity.js";

async function main(): Promise<void> {
  const config = readAdapterConfig();
  const port = Number.parseInt(process.env["PORT"] ?? "9200", 10);
  const adapter = new SecureLendAdapter({ port, config });

  const shutdown = async (): Promise<void> => {
    await adapter.stop();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  await adapter.start();
  const bound = adapter.portNumber ?? port;
  const target =
    config.mode === "protocol" ? config.protocolUpstream : config.mcp?.url;
  console.log(
    `[securelend-adapter] ${config.participant.harness} model=${config.participant.model} mode=${config.mode} → ${target} on http://127.0.0.1:${bound}`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "[securelend-adapter]",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
