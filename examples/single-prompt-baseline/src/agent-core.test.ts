import { describe, expect, it } from "vitest";
import { UnderwritingSubmissionSchema } from "../../../packages/protocol/dist/index.js";
import {
  buildPrompt,
  createInsufficientSubmission,
  parseSubmission,
  type GenerationMetadata,
  type PromptContext,
} from "./agent-core.js";

const context: PromptContext = {
  caseId: "opaque-case",
  objective: "Underwrite the applicant using only this sentence.",
  requiredOutputs: ["recommendation"],
  lane: "reasoning_only",
};

const metadata: GenerationMetadata = {
  promptVersion: "prompt-v1",
  provider: "mock",
  providerVersion: "provider-v1",
  model: "model",
  modelVersion: "model-v1",
  temperature: 0,
  maxTokens: 4_000,
  inputTokens: 12,
  outputTokens: 0,
  latencyMs: 0,
};

describe("single prompt core", () => {
  it("builds the prompt only from participant-visible request fields", () => {
    const prompt = buildPrompt(context);
    expect(prompt).toContain(context.objective);
    expect(prompt).toContain(context.caseId);
    expect(prompt).not.toContain("toolGateway");
    expect(prompt).not.toContain("bearerToken");
  });

  it("produces an honest, protocol-valid mock result without hidden facts", () => {
    const result = createInsufficientSubmission(context, metadata);
    expect(UnderwritingSubmissionSchema.safeParse(result).success).toBe(true);
    expect(result.recommendation.decision).toBe("INSUFFICIENT_INFORMATION");
    expect(result.normalizedFacts).toEqual([]);
    expect(result.memo.markdown).toContain("mock@provider-v1");
    expect(result.memo.markdown).toContain("model@model-v1");
  });

  it("parses exactly one structured response", () => {
    const result = createInsufficientSubmission(context, metadata);
    expect(parseSubmission(JSON.stringify(result))).toEqual(result);
    expect(
      parseSubmission(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``),
    ).toEqual(result);
  });
});
