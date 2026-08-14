import { RealSinglePromptAgent, type RealAgentConfig } from "./real-agent.js";
import {
  FakeAgent,
  type FakeAgentConfig,
} from "../../../packages/testkit/dist/index.js";

export interface AgentConfig {
  port: number;
  behavior?:
    | "complete"
    | "fail"
    | "running"
    | "awaitingTool"
    | "timeout"
    | "idempotent"
    | "rejectUnknownVersion"
    | "oversizedOutput"
    | "invalidSchema"
    | "restartDuringRun";
  submission?: FakeAgentConfig["submission"];
  timeoutMs?: FakeAgentConfig["timeoutMs"];
  oversizedOutput?: FakeAgentConfig["oversizedOutput"];
  invalidSubmission?: FakeAgentConfig["invalidSubmission"];
  error?: FakeAgentConfig["error"];
  /** Use the real single-prompt agent that processes case data via LLM */
  real?: boolean;
  /** LLM configuration (only used when real=true) */
  llmConfig?: RealAgentConfig["llmConfig"] | undefined;
}

export class SinglePromptAgent {
  private fakeAgent: FakeAgent | null = null;
  private realAgent: RealSinglePromptAgent | null = null;

  constructor(config: AgentConfig) {
    if (config.real) {
      this.realAgent = new RealSinglePromptAgent({
        port: config.port,
        llmConfig: config.llmConfig ?? {
          provider: "mock",
          providerVersion: "1.0",
          model: "mock",
          modelVersion: "1.0",
        },
      });
    } else {
      this.fakeAgent = new FakeAgent({
        baseUrl: `http://localhost:${config.port}`,
        behavior: config.behavior ?? "complete",
        submission: config.submission,
        timeoutMs: config.timeoutMs,
        oversizedOutput: config.oversizedOutput,
        invalidSubmission: config.invalidSubmission,
        error: config.error,
      });
    }
  }

  async start(): Promise<void> {
    if (this.realAgent) {
      await this.realAgent.start();
    } else if (this.fakeAgent) {
      await this.fakeAgent.start();
    }
  }

  async stop(): Promise<void> {
    if (this.realAgent) {
      await this.realAgent.stop();
    } else if (this.fakeAgent) {
      await this.fakeAgent.stop();
    }
  }
}

export { RealSinglePromptAgent, type RealAgentConfig } from "./real-agent.js";
export {
  buildPrompt,
  parseSubmission,
  createInsufficientSubmission,
  type PromptContext,
  type GenerationMetadata,
} from "./agent-core.js";
export { createLLMClient, type LLMClient } from "./llm-client.js";
