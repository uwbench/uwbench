import { RealDeterministicAgent } from "./real-agent.js";
import { FakeAgent, type FakeAgentConfig } from "@uwbench/testkit";

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
  /** Use the real deterministic agent that processes case data via tool gateway */
  real?: boolean;
}

export class DeterministicAgent {
  private fakeAgent: FakeAgent | null = null;
  private realAgent: RealDeterministicAgent | null = null;

  constructor(config: AgentConfig) {
    if (config.real) {
      this.realAgent = new RealDeterministicAgent({ port: config.port });
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
