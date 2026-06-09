import { GoogleGenAI } from "@google/genai";
import type { CompletionRequest, CompletionResponse, Provider } from "../types.js";

/**
 * Google Gemini provider. The SDK reads GEMINI_API_KEY (or GOOGLE_API_KEY)
 * from the environment.
 */
export class GeminiProvider implements Provider {
  readonly name = "gemini";
  private client: GoogleGenAI;

  constructor(client?: GoogleGenAI) {
    this.client = client ?? new GoogleGenAI({});
  }

  async complete(model: string, req: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.models.generateContent({
      model,
      contents: req.prompt,
      config: {
        maxOutputTokens: req.maxTokens ?? 1024,
        ...(req.system ? { systemInstruction: req.system } : {}),
      },
    });
    return {
      text: response.text ?? "",
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
