import { FakeAgent, type FakeAgentConfig } from "@uwbench/testkit";
import { RealToolAgent } from "./real-agent.js";

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
  real?: boolean;
}

export class ToolAgent {
  private fakeAgent: FakeAgent | null = null;
  private realAgent: RealToolAgent | null = null;

  constructor(config: AgentConfig) {
    if (config.real) {
      this.realAgent = new RealToolAgent({ port: config.port });
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

export { RealToolAgent } from "./real-agent.js";
export {
  ADVERTISED_TOOLS,
  AGENT_VERSION,
  createToolClient,
  runToolAgent,
} from "./agent-core.js";
