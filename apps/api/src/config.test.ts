import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('supported AI modes', () => {
  it('requires explicit OpenAI credentials/model and defaults to stub', () => {
    expect(() => loadConfig({ AI_MODE: 'openai' })).toThrow('requires OPENAI_API_KEY and OPENAI_MODEL');
    expect(loadConfig({ AI_MODE: 'openai', OPENAI_API_KEY: 'test', OPENAI_MODEL: 'test-model' }).AI_MODE).toBe('openai');
    expect(loadConfig({}).AI_MODE).toBe('stub');
  });
});
