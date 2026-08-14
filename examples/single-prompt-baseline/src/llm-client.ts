import {
  PROMPT_VERSION,
  type GenerationMetadata,
  type SinglePromptConfig,
} from "./agent-core.js";

export interface LLMClient {
  generate(
    prompt: string,
    config: SinglePromptConfig,
  ): Promise<{ text: string; metadata: GenerationMetadata }>;
}

function metadata(
  config: SinglePromptConfig,
  latencyMs: number,
  usage: { inputTokens?: number; outputTokens?: number } = {},
): GenerationMetadata {
  return {
    promptVersion: PROMPT_VERSION,
    provider: config.provider,
    providerVersion: config.providerVersion,
    model: config.model,
    modelVersion: config.modelVersion,
    temperature: config.temperature ?? 0,
    maxTokens: config.maxTokens ?? 4_000,
    latencyMs,
    ...usage,
  };
}

export class MockLLMClient implements LLMClient {
  async generate(prompt: string, config: SinglePromptConfig) {
    return {
      text: "__UWBench_mock_insufficient__",
      metadata: metadata(config, 0, {
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: 0,
      }),
    };
  }
}

export class OpenAICompatibleClient implements LLMClient {
  async generate(prompt: string, config: SinglePromptConfig) {
    if (!config.baseUrl || !config.apiKey) {
      throw new Error("LLM_BASE_URL and LLM_API_KEY are required");
    }
    const startedAt = Date.now();
    const response = await fetch(
      `${config.baseUrl.replace(/\/$/u, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          temperature: config.temperature ?? 0,
          max_tokens: config.maxTokens ?? 4_000,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 120_000),
      },
    );
    if (!response.ok) throw new Error(`LLM API returned ${response.status}`);
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      metadata: metadata(config, Date.now() - startedAt, {
        ...(body.usage?.prompt_tokens === undefined
          ? {}
          : { inputTokens: body.usage.prompt_tokens }),
        ...(body.usage?.completion_tokens === undefined
          ? {}
          : { outputTokens: body.usage.completion_tokens }),
      }),
    };
  }
}

export function createLLMClient(config: SinglePromptConfig): LLMClient {
  return config.provider === "mock"
    ? new MockLLMClient()
    : new OpenAICompatibleClient();
}
