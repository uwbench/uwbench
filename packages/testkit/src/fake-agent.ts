export class FakeAgent {
  async handleRequest(_request: unknown): Promise<unknown> {
    return { status: "ok" };
  }
}
