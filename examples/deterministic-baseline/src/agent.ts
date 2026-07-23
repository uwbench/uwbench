export interface AgentConfig {
  port: number;
}

export class DeterministicAgent {
  constructor(_config: AgentConfig) {}
  
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}