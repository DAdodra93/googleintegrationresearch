import type { AiCompletionRequest, AiProvider } from './provider.js';

/** Deterministic canned output so AI-dependent flows run without a key. */
export class StubAiProvider implements AiProvider {
  readonly name = 'stub';
  readonly stub = true;

  async complete(req: AiCompletionRequest): Promise<string> {
    if (req.json) {
      return JSON.stringify({ stub: true, note: 'StubAiProvider canned JSON', promptPreview: req.prompt.slice(0, 120) });
    }
    return `[stub-ai] ${req.prompt.slice(0, 200)}`;
  }
}
