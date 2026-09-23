import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('supported AI modes', () => {
  it('rejects the unimplemented OpenAI mode before the server starts', () => {
    expect(() => loadConfig({ AI_MODE: 'openai' })).toThrow('AI_MODE=openai is not implemented');
    expect(loadConfig({}).AI_MODE).toBe('stub');
  });
});
