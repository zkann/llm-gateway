import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResponse, Provider } from "../types.js";

/**
 * Anthropic provider. The SDK reads ANTHROPIC_API_KEY from the environment;
 * its own retry logic is disabled (maxRetries: 0) because retries are the
 * gateway's job — double-retrying skews the telemetry and the fallback timing.
 */
export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic({ maxRetries: 0 });
  }

  async complete(model: string, req: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.messages.create({
      model,
      max_tokens: req.maxTokens ?? 1024,
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: "user", content: req.prompt }],
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
