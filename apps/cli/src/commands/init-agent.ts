import { Command } from "commander";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

export const initAgentCommand = new Command("init-agent")
  .description("Create an example agent server stub")
  .argument("[output-dir]", "Output directory for the agent stub", ".")
  .option("--force", "Overwrite existing files")
  .option(
    "--language <lang>",
    "Language for the stub (typescript)",
    "typescript",
  )
  .action(async (outputDir: string, options) => {
    const targetDir = resolve(process.cwd(), outputDir);

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const files = [
      {
        path: join(targetDir, "package.json"),
        content: getPackageJson(),
      },
      {
        path: join(targetDir, "tsconfig.json"),
        content: getTsConfig(),
      },
      {
        path: join(targetDir, "src", "agent.ts"),
        content: getPortableAgentTs(),
      },
      {
        path: join(targetDir, "src", "server.ts"),
        content: getServerTs(),
      },
      {
        path: join(targetDir, "src", "index.ts"),
        content: getIndexTs(),
      },
      {
        path: join(targetDir, ".gitignore"),
        content: getGitignore(),
      },
    ];

    for (const file of files) {
      const fileDir = dirname(file.path);
      if (!existsSync(fileDir)) {
        mkdirSync(fileDir, { recursive: true });
      }

      if (existsSync(file.path) && !options.force) {
        console.warn(
          `Skipping existing file: ${file.path} (use --force to overwrite)`,
        );
        continue;
      }

      writeFileSync(file.path, file.content);
      console.log(`Created ${file.path}`);
    }

    console.log("\nExample agent stub created!");
    console.log("To run the agent:");
    console.log("  cd " + outputDir);
    console.log("  pnpm install");
    console.log("  pnpm build");
    console.log("  pnpm start");
    console.log("\nThe agent will listen on http://localhost:9090");
  });

function getPackageJson(): string {
  return JSON.stringify(
    {
      name: "uwbench-example-agent",
      version: "0.0.1",
      private: true,
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      scripts: {
        build: "tsc --build",
        start: "node dist/index.js",
        dev: "tsx watch src/index.ts",
        typecheck: "tsc --noEmit",
        lint: "eslint src --ext .ts",
      },
      devDependencies: {
        typescript: "^5.5.4",
        tsx: "^4.16.2",
        "@types/node": "^20.14.10",
        eslint: "^9.8.0",
      },
      dependencies: {
        fastify: "^4.28.1",
      },
    },
    null,
    2,
  );
}

function getTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        outDir: "./dist",
        rootDir: "./src",
        lib: ["ES2022"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true,
      },
      include: ["src/**/*"],
    },
    null,
    2,
  );
}

function getPortableAgentTs(): string {
  return `import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

type RunStatus = "accepted" | "running" | "completed" | "failed" | "cancelled";
interface RunRequest { schemaVersion: string; idempotencyKey?: string; [key: string]: unknown }
interface ProtocolError { schemaVersion: "1.0"; code: string; message: string; requestId: string }
interface StoredRun { request: RunRequest; status: RunStatus; result?: Record<string, unknown>; error?: ProtocolError }

function protocolError(code: string, message: string): ProtocolError {
  return { schemaVersion: "1.0", code, message, requestId: randomUUID() };
}

export class ExampleAgent {
  private readonly runs = new Map<string, StoredRun>();

  registerRoutes(app: FastifyInstance): void {
    app.get("/health", async (_request, reply) =>
      reply.send({ schemaVersion: "1.0", status: "ok", version: "0.0.1", protocolVersion: "1.0" }),
    );
    app.post("/v1/runs", this.handleStartRun.bind(this));
    app.get("/v1/runs/:agentRunId", this.handleGetRun.bind(this));
    app.delete("/v1/runs/:agentRunId", this.handleCancelRun.bind(this));
  }

  private async handleStartRun(
    request: FastifyRequest<{ Body: Partial<RunRequest> }>,
    reply: FastifyReply,
  ): Promise<unknown> {
    const body = request.body;
    if (body.schemaVersion !== "1.0") {
      return reply.code(400).send(protocolError("INVALID_SCHEMA_VERSION", "Unsupported schema version"));
    }
    if (body.idempotencyKey) {
      for (const [id, run] of this.runs) {
        if (run.request.idempotencyKey === body.idempotencyKey) {
          return reply.send({ schemaVersion: "1.0", agentRunId: id, status: "accepted" });
        }
      }
    }
    const agentRunId = "agent_run_" + randomUUID().slice(0, 8);
    this.runs.set(agentRunId, { request: body as RunRequest, status: "accepted" });
    void this.processRun(agentRunId);
    return reply.send({ schemaVersion: "1.0", agentRunId, status: "accepted" });
  }

  private async handleGetRun(
    request: FastifyRequest<{ Params: { agentRunId: string } }>,
    reply: FastifyReply,
  ): Promise<unknown> {
    const { agentRunId } = request.params;
    const run = this.runs.get(agentRunId);
    if (!run) return reply.code(404).send(protocolError("RUN_NOT_FOUND", "Run not found: " + agentRunId));
    if (run.status === "completed") {
      return reply.send({ schemaVersion: "1.0", agentRunId, status: "completed", result: run.result });
    }
    if (run.status === "failed") {
      return reply.send({ schemaVersion: "1.0", agentRunId, status: "failed", error: run.error });
    }
    return reply.send({ schemaVersion: "1.0", agentRunId, status: run.status });
  }

  private async handleCancelRun(
    request: FastifyRequest<{ Params: { agentRunId: string } }>,
    reply: FastifyReply,
  ): Promise<unknown> {
    const { agentRunId } = request.params;
    const run = this.runs.get(agentRunId);
    if (!run) return reply.code(404).send(protocolError("RUN_NOT_FOUND", "Run not found: " + agentRunId));
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      return reply.code(409).send(protocolError("INVALID_RUN_STATE", "Run is already terminal"));
    }
    run.status = "cancelled";
    return reply.send({ schemaVersion: "1.0", agentRunId, cancelled: true });
  }

  private async processRun(agentRunId: string): Promise<void> {
    const run = this.runs.get(agentRunId);
    if (!run) return;
    run.status = "running";
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (this.runs.get(agentRunId)?.status === "cancelled") return;
    run.result = {
      schemaVersion: "1.0",
      financialSpread: {
        revenue: { amount: 1000000, currency: "USD" },
        period: { start: "2024-01-01", end: "2024-12-31" },
        currency: "USD", scale: "units", signConvention: "positive_revenue_negative_expense",
      },
      normalizedFacts: [], risks: [], discrepancies: [], complianceFindings: [], followUpRequests: [],
      policyAssessment: { applicableRules: [], evaluations: [] },
      recommendation: {
        decision: "INSUFFICIENT_INFORMATION", confidence: 0.5,
        conditions: [], policyExceptions: [], rationale: [],
      },
      memo: { markdown: "Example agent memo", claims: [] },
      confidence: { overall: 0.5, byComponent: {} },
    };
    run.status = "completed";
  }
}
`;
}

function getServerTs(): string {
  const lines = [
    'import { FastifyInstance, FastifyServerOptions } from "fastify";',
    'import { ExampleAgent } from "./agent.js";',
    "",
    "/**",
    " * Create and configure the Fastify server",
    " */",
    "export async function createServer(",
    "  options: FastifyServerOptions = {},",
    "): Promise<FastifyInstance> {",
    '  const { fastify } = await import("fastify");',
    "  const app = fastify(options);",
    "  app.setErrorHandler((_error, _request, reply) => {",
    '    reply.code(400).send({ schemaVersion: "1.0", code: "INVALID_SUBMISSION", message: "Malformed request", requestId: "request-malformed" });',
    "  });",
    "",
    "  // Register agent routes",
    "  const agent = new ExampleAgent();",
    "  agent.registerRoutes(app);",
    "",
    "  // Graceful shutdown",
    "  const shutdown = async () => {",
    '    console.log("Shutting down...");',
    "    await app.close();",
    "    process.exit(0);",
    "  };",
    "",
    '  process.on("SIGTERM", shutdown);',
    '  process.on("SIGINT", shutdown);',
    "",
    "  return app;",
    "}",
    "",
  ];
  return lines.join("\n");
}

function getIndexTs(): string {
  const lines = [
    'import { createServer } from "./server.js";',
    "",
    'const PORT = parseInt(process.env.PORT ?? "9090", 10);',
    'const HOST = process.env.HOST ?? "0.0.0.0";',
    "",
    "async function main() {",
    "  const app = await createServer({ logger: true });",
    "",
    "  try {",
    "    await app.listen({ port: PORT, host: HOST });",
    "    console.log(`Agent server listening on http://${HOST}:${PORT}`);",
    "  } catch (err) {",
    "    app.log.error(err);",
    "    process.exit(1);",
    "  }",
    "}",
    "",
    "main();",
    "",
  ];
  return lines.join("\n");
}

function getGitignore(): string {
  return `node_modules
dist
.tsbuildinfo
*.log
.DS_Store
.env
.env.local
`;
}
