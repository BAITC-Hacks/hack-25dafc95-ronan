import { describe, expect, it, vi } from 'vitest';
import { OpenAiResponsesProvider } from './provider.js';

describe('OpenAI Responses provider', () => {
  it('sends bounded catalog facts and reads output text', async () => {
    let captured: RequestInit | undefined;
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      captured = init;
      return Response.json({ output: [{ content: [{ type: 'output_text', text: '  Ответ по фактам.  ' }] }] });
    });
    const provider = new OpenAiResponsesProvider('test-key', 'test-model', 1000, fetcher);
    await expect(provider.answer({ message: 'Найди автомат', products: [{ id: 1 }] })).resolves.toBe('Ответ по фактам.');
    const body = JSON.parse(String(captured?.body));
    expect(body.model).toBe('test-model');
    expect(body.store).toBe(false);
    expect(body.input).toContain('"id":1');
  });

  it('fails closed when the provider returns no text', async () => {
    const provider = new OpenAiResponsesProvider('test-key', 'test-model', 1000, async () => Response.json({ output: [] }));
    await expect(provider.answer({ message: 'test', products: [] })).rejects.toThrow('did not contain output text');
  });
});
