export interface ToolGatewayOptions {
  port: number;
}

export class ToolGateway {
  constructor(_options: ToolGatewayOptions) {}
  
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}