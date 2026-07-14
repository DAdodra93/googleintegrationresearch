/**
 * Provider-swappable AI seam. Everything "improve with AI" in either module
 * goes through this interface — no Google-hosted models, ever. Default
 * implementation is OpenAI-family; swapping providers is a new class here,
 * not a change in module code.
 */
export interface AiCompletionRequest {
  system?: string;
  prompt: string;
  /** Ask for a strict-JSON response (parsed by the caller). */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface AiProvider {
  readonly name: string;
  readonly stub: boolean;
  complete(req: AiCompletionRequest): Promise<string>;
}
