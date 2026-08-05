import { Command } from "commander";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

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
    const targetDir = join(process.cwd(), outputDir);

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
        content: getAgentTs(),
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
        "@uwbench/protocol": "workspace:*",
        fastify: "^4.28.1",
        zod: "^3.23.8",
      },
    },
    null,
    2,
  );
}

function getTsConfig(): string {
  return JSON.stringify(
    {
      extends: "../../tsconfig.base.json",
      compilerOptions: {
        composite: true,
        tsBuildInfoFile: "./.tsbuildinfo",
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
      references: [{ path: "../../packages/protocol" }],
    },
    null,
    2,
  );
}

function getAgentTs(): string {
  // Use a function to avoid template literal escaping issues
  const lines = [
    'import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";',
    "import {",
    "  HealthResponseSchema,",
    "  RunResponseSchema,",
    "  RunStatusResponseSchema,",
    "  CancelResponseSchema,",
    "  ProtocolErrorSchema,",
    "  UnderwritingSubmissionSchema,",
    "  type RunRequest,",
    "  type RunResponse,",
    "  type RunStatusResponse,",
    "  type CancelResponse,",
    "  type ProtocolError,",
    "  type UnderwritingSubmission,",
    "  type HealthResponse,",
    '} from "@uwbench/protocol";',
    'import { randomUUID } from "node:crypto";',
    "",
    "/**",
    " * Example agent implementation.",
    " * Replace this with your actual underwriting logic.",
    " */",
    "export class ExampleAgent {",
    "  private runs = new Map<",
    "    string,",
    '    { request: RunRequest; status: RunStatusResponse["status"]; result?: UnderwritingSubmission; error?: ProtocolError }',
    "  >();",
    "",
    "  /**",
    "   * Register routes on the Fastify instance",
    "   */",
    "  registerRoutes(app: FastifyInstance): void {",
    '    app.get("/health", this.handleHealth.bind(this));',
    '    app.post("/v1/runs", this.handleStartRun.bind(this));',
    '    app.get("/v1/runs/:agentRunId", this.handleGetRun.bind(this));',
    '    app.delete("/v1/runs/:agentRunId", this.handleCancelRun.bind(this));',
    "  }",
    "",
    "  private async handleHealth(",
    "    _request: FastifyRequest,",
    "    reply: FastifyReply,",
    "  ): Promise<HealthResponse> {",
    "    const response: HealthResponse = {",
    '      schemaVersion: "1.0",',
    '      status: "ok",',
    '      version: "0.0.1",',
    "    };",
    "    const parsed = HealthResponseSchema.safeParse(response);",
    "    if (!parsed.success) {",
    '      return reply.code(500).send({ message: "Internal health check failed" });',
    "    }",
    "    return reply.send(parsed.data);",
    "  }",
    "",
    "  private async handleStartRun(",
    "    request: FastifyRequest<{ Body: RunRequest }>,",
    "    reply: FastifyReply,",
    "  ): Promise<RunResponse> {",
    "    const body = request.body;",
    "",
    "    // Validate schema version",
    '    if (body.schemaVersion !== "1.0") {',
    "      const error: ProtocolError = {",
    '        schemaVersion: "1.0",',
    '        code: "INVALID_SCHEMA_VERSION",',
    "        message: `Unsupported schema version: ${body.schemaVersion}`,",
    "        requestId: randomUUID(),",
    "      };",
    "      return reply.code(400).send(error);",
    "    }",
    "",
    "    // Check idempotency key",
    "    if (body.idempotencyKey) {",
    "      for (const [id, run] of this.runs) {",
    "        if (run.request.idempotencyKey === body.idempotencyKey) {",
    '          return reply.send({ schemaVersion: "1.0", agentRunId: id, status: "accepted" });',
    "        }",
    "      }",
    "    }",
    "",
    "    const agentRunId = `agent_run_${randomUUID().slice(0, 8)}`;",
    "",
    "    // Store run with initial status",
    '    this.runs.set(agentRunId, { request: body, status: "accepted" });',
    "",
    "    // Simulate async processing",
    "    this.processRun(agentRunId, body);",
    "",
    '    return reply.send({ schemaVersion: "1.0", agentRunId, status: "accepted" });',
    "  }",
    "",
    "  private async handleGetRun(",
    "    request: FastifyRequest<{ Params: { agentRunId: string } }>,",
    "    reply: FastifyReply,",
    "  ): Promise<RunStatusResponse> {",
    "    const { agentRunId } = request.params;",
    "    const run = this.runs.get(agentRunId);",
    "",
    "    if (!run) {",
    "      const error: ProtocolError = {",
    '        schemaVersion: "1.0",',
    '        code: "RUN_NOT_FOUND",',
    "        message: `Run not found: ${agentRunId}`,",
    "        requestId: randomUUID(),",
    "      };",
    "      return reply.code(404).send(error);",
    "    }",
    "",
    "    const response: RunStatusResponse = {",
    '      schemaVersion: "1.0",',
    "      agentRunId,",
    "      status: run.status,",
    "    };",
    "",
    '    if (run.status === "completed" && run.result) {',
    "      response.result = run.result;",
    "    }",
    '    if (run.status === "failed" && run.error) {',
    "      response.error = run.error;",
    "    }",
    "",
    "    const parsed = RunStatusResponseSchema.safeParse(response);",
    "    if (!parsed.success) {",
    "      const error: ProtocolError = {",
    '        schemaVersion: "1.0",',
    '        code: "INTERNAL_ERROR",',
    '        message: "Invalid status response",',
    "        requestId: randomUUID(),",
    "      };",
    "      return reply.code(500).send(error);",
    "    }",
    "",
    "    return reply.send(parsed.data);",
    "  }",
    "",
    "  private async handleCancelRun(",
    "    request: FastifyRequest<{ Params: { agentRunId: string } }>,",
    "    reply: FastifyReply,",
    "  ): Promise<CancelResponse> {",
    "    const { agentRunId } = request.params;",
    "    const run = this.runs.get(agentRunId);",
    "",
    "    if (!run) {",
    "      const error: ProtocolError = {",
    '        schemaVersion: "1.0",',
    '        code: "RUN_NOT_FOUND",',
    "        message: `Run not found: ${agentRunId}`,",
    "        requestId: randomUUID(),",
    "      };",
    "      return reply.code(404).send(error);",
    "    }",
    "",
    "    // Check if already terminal",
    "    if (",
    '      run.status === "completed" ||',
    '      run.status === "failed" ||',
    '      run.status === "cancelled"',
    "    ) {",
    "      return reply.code(409).send({",
    '        schemaVersion: "1.0",',
    "        cancelled: false,",
    "        error: {",
    '          schemaVersion: "1.0",',
    '          code: "INVALID_RUN_STATE",',
    "          message: `Cannot cancel run in status: ${run.status}`,",
    "          requestId: randomUUID(),",
    "        },",
    "      });",
    "    }",
    "",
    '    run.status = "cancelled";',
    "",
    '    return reply.send({ schemaVersion: "1.0", cancelled: true });',
    "  }",
    "",
    "  /**",
    "   * Process the run asynchronously.",
    "   * In a real agent, this would call the tool gateway, execute the underwriting logic,",
    "   * and eventually update the run status to completed or failed.",
    "   */",
    "  private async processRun(agentRunId: string, request: RunRequest): Promise<void> {",
    "    const run = this.runs.get(agentRunId);",
    "    if (!run) return;",
    "",
    '    run.status = "running";',
    "",
    "    try {",
    "      // Simulate some processing time",
    "      await new Promise((resolve) => setTimeout(resolve, 1000));",
    "",
    "      // Create a minimal valid submission",
    "      const submission: UnderwritingSubmission = {",
    '        schemaVersion: "1.0",',
    "        financialSpread: {",
    '          revenue: { amount: 1000000, currency: "USD" },',
    '          period: { start: "2024-01-01", end: "2024-12-31" },',
    '          currency: "USD",',
    '          scale: "units",',
    '          signConvention: "positive_revenue_negative_expense",',
    "        },",
    "        normalizedFacts: [],",
    "        risks: [],",
    "        discrepancies: [],",
    "        complianceFindings: [],",
    "        followUpRequests: [],",
    "        policyAssessment: {",
    "          applicableRules: [],",
    "          evaluations: [],",
    "        },",
    "        recommendation: {",
    '          decision: "INSUFFICIENT_INFORMATION",',
    "          confidence: 0.5,",
    "          conditions: [],",
    "          policyExceptions: [],",
    "          rationale: [],",
    "        },",
    "        memo: {",
    '          markdown: "Example agent memo - replace with actual underwriting analysis",',
    "          claims: [],",
    "        },",
    "        confidence: {",
    "          overall: 0.5,",
    "          byComponent: {},",
    "        },",
    "      };",
    "",
    "      // Validate submission",
    "      const parsed = UnderwritingSubmissionSchema.safeParse(submission);",
    "      if (!parsed.success) {",
    "        throw new Error(`Invalid submission: ${parsed.error.message}`);",
    "      }",
    "",
    '      run.status = "completed";',
    "      run.result = parsed.data;",
    "    } catch (error) {",
    '      run.status = "failed";',
    "      run.error = {",
    '        schemaVersion: "1.0",',
    '        code: "AGENT_CRASHED",',
    "        message: error instanceof Error ? error.message : String(error),",
    "        requestId: randomUUID(),",
    "      };",
    "    }",
    "  }",
    "}",
    "",
    'type RunStatusResponse = import("@uwbench/protocol").RunStatusResponse;',
    "",
  ];
  return lines.join("\n");
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
