import type { AppConfig } from '../config.js';
import type { AiProvider } from './provider.js';
import { OpenAiProvider } from './openai.js';
import { StubAiProvider } from './stub.js';

export type { AiProvider, AiCompletionRequest } from './provider.js';

export function createAiProvider(config: AppConfig): AiProvider {
  if (config.ai.stub || !config.ai.openaiApiKey) return new StubAiProvider();
  return new OpenAiProvider(config.ai.openaiApiKey, config.ai.model);
}
