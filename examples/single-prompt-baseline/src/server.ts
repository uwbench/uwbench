import {
  SinglePromptAgent,
  type AgentConfig,
  type RealAgentConfig,
} from "./agent.js";

async function main(): Promise<void> {
  const port = parseInt(process.env["PORT"] ?? "9090", 10);
  const behavior =
    (process.env["BEHAVIOR"] as AgentConfig["behavior"]) ?? "complete";
  const real = process.env["REAL"] === "true";

  // LLM configuration from environment
  const llmConfig: RealAgentConfig["llmConfig"] | undefined = real
    ? {
        provider:
          (process.env[
            "LLM_PROVIDER"
          ] as RealAgentConfig["llmConfig"]["provider"]) ?? "mock",
        providerVersion: process.env["LLM_PROVIDER_VERSION"] ?? "1.0",
        model: process.env["LLM_MODEL"] ?? "mock",
        modelVersion: process.env["LLM_MODEL_VERSION"] ?? "1.0",
        ...(process.env["LLM_API_KEY"]
          ? { apiKey: process.env["LLM_API_KEY"] }
          : {}),
        ...(process.env["LLM_BASE_URL"]
          ? { baseUrl: process.env["LLM_BASE_URL"] }
          : {}),
        ...(process.env["LLM_TEMPERATURE"]
          ? { temperature: parseFloat(process.env["LLM_TEMPERATURE"]) }
          : {}),
        ...(process.env["LLM_MAX_TOKENS"]
          ? { maxTokens: parseInt(process.env["LLM_MAX_TOKENS"], 10) }
          : {}),
        ...(process.env["LLM_TIMEOUT_MS"]
          ? { timeoutMs: parseInt(process.env["LLM_TIMEOUT_MS"], 10) }
          : {}),
      }
    : undefined;

  const agent = new SinglePromptAgent({ port, behavior, real, llmConfig });

  const shutdown = async (): Promise<void> => {
    await agent.stop();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  await agent.start();
  console.log(
    `[single-prompt-baseline] Listening on http://localhost:${port} (${real ? "real" : behavior})`,
  );
}

main().catch((err) => {
  console.error("[single-prompt-baseline] Fatal error:", err);
  process.exit(1);
});
