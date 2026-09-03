import { describe, expect, it } from "vitest";
import { clientCredentialsToken, registerFreshM2mClient } from "./m2m.js";

describe("fresh M2M identity", () => {
  it("registers a unique client_name and never reuses a prior secret", async () => {
    const names: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? init.body : "";
      if (url.endsWith("/oauth/m2m/register")) {
        const parsed = JSON.parse(body) as { client_name?: string };
        names.push(String(parsed.client_name));
        return new Response(
          JSON.stringify({
            client_id: `id-${names.length}`,
            client_secret: `secret-${names.length}`,
            token_endpoint: "http://127.0.0.1/oauth/token",
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const first = await registerFreshM2mClient(
      "https://agents.securelend.ai",
      fetchImpl,
    );
    const second = await registerFreshM2mClient(
      "https://agents.securelend.ai",
      fetchImpl,
    );
    expect(first.clientName).toMatch(/^uwbench-public-bench-/);
    expect(second.clientName).not.toBe(first.clientName);
    expect(first.clientSecret).not.toBe(second.clientSecret);
    expect(JSON.stringify(names)).not.toMatch(/jayjchow|rekord|google/i);
  });

  it("exchanges client_credentials and strips nothing into a Google login", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push(String(input));
      const params = new URLSearchParams(String(init?.body ?? ""));
      expect(params.get("grant_type")).toBe("client_credentials");
      expect(params.get("client_id")).toBe("fresh-id");
      expect(params.get("scope")).toBe(
        "https://agents.securelend.ai/mcp.access",
      );
      return new Response(
        JSON.stringify({
          access_token: "tok_abc",
          token_type: "Bearer",
          expires_in: 60,
        }),
        { status: 200 },
      );
    };
    const token = await clientCredentialsToken(
      {
        clientName: "uwbench-public-bench-test",
        clientId: "fresh-id",
        clientSecret: "fresh-secret",
        tokenEndpoint: "https://agents.securelend.ai/oauth/token",
        scope: "https://agents.securelend.ai/mcp.access",
      },
      fetchImpl,
    );
    expect(token.accessToken).toBe("tok_abc");
    expect(seen[0]).toContain("/oauth/token");
    expect(seen.join(" ")).not.toMatch(/accounts\.google|login\/google/i);
  });
});
