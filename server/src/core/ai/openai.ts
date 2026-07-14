import type { AiCompletionRequest, AiProvider } from './provider.js';

export class OpenAiProvider implements AiProvider {
  readonly name: string;
  readonly stub = false;

  constructor(private apiKey: string, private model: string) {
    this.name = `openai:${model}`;
  }

  async complete(req: AiCompletionRequest): Promise<string> {
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      { role: 'user', content: req.prompt },
    ];
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 1024,
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`openai request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const content = json.choices[0]?.message?.content;
    if (!content) throw new Error('openai returned no content');
    return content;
  }
}
