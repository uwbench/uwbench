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
}

export class DeterministicAgent {
  private fakeAgent: FakeAgent;

  constructor(config: AgentConfig) {
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

  async start(): Promise<void> {
    await this.fakeAgent.start();
  }

  async stop(): Promise<void> {
    await this.fakeAgent.stop();
  }
}
