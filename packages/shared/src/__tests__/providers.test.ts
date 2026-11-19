import { describe, expect, it } from 'vitest';

import { markGradient, markInitials, PROVIDER_MARKS, providerMark, type MarkArt } from '../providers';

describe('providerMark', () => {
  it.each([
    ['deepseek-chat', 'deepseek'],
    ['deepseek/deepseek-r1', 'deepseek'],
    ['gpt-4o-mini', 'openai'],
    ['o3-mini', 'openai'],
    ['openai/gpt-oss-120b', 'openai'],
    ['claude-sonnet-4-5', 'anthropic'],
    ['gemini-2.5-pro', 'google'],
    ['qwen3-coder-plus', 'qwen'],
    ['QwQ-32B', 'qwen'],
    ['kimi-k2-turbo-preview', 'kimi'],
    ['moonshot-v1-128k', 'kimi'],
    ['glm-4.6', 'zhipu'],
    ['doubao-seed-1-6-250615', 'doubao'],
    ['MiniMax-M2', 'minimax'],
    ['meta-llama/Llama-3.3-70B-Instruct', 'meta'],
    ['mistral-large-latest', 'mistral'],
    ['grok-4', 'xai'],
    ['ERNIE-4.5-turbo', 'wenxin'],
    ['hunyuan-turbos-latest', 'hunyuan'],
    ['step-2-16k', 'stepfun'],
    ['Baichuan4', 'baichuan'],
  ])('names %s as %s', (model, mark) => {
    expect(providerMark(model)).toBe(mark);
  });

  it('prefers the model to where it is called', () => {
    expect(providerMark('deepseek/deepseek-chat', 'openrouter', 'https://openrouter.ai/api/v1')).toBe('deepseek');
    expect(providerMark('some-router-model', 'openrouter')).toBe('openrouter');
    expect(providerMark('company-model', 'gateway', 'https://api.siliconflow.cn/v1')).toBe('siliconflow');
  });

  it('keeps Ollama apart from Meta', () => {
    expect(providerMark('ollama')).toBe('ollama');
    expect(providerMark('llama3.1:8b', 'ollama')).toBe('meta');
  });

  it('does not guess from words that merely contain a model family', () => {
    expect(providerMark('company-gateway', 'https://llm.example.com/v1')).toBeUndefined();
    expect(providerMark('studio-1', 'photo3')).toBeUndefined();
    expect(providerMark(undefined, '', null)).toBeUndefined();
  });

  it('draws every mark, each gradient fill naming one of its own gradients', () => {
    for (const art of Object.values(PROVIDER_MARKS) as MarkArt[]) {
      expect(art.shapes.length).toBeGreaterThan(0);
      for (const shape of art.shapes) {
        expect(shape.d ?? shape.circle).toBeDefined();
        const gradient = markGradient(shape.fill);
        if (gradient !== undefined) expect(art.gradients?.[gradient]).toBeDefined();
        else expect(shape.fill).toMatch(/^(#[0-9a-f]{6}|gold)$/i);
      }
    }
  });
});

describe('markInitials', () => {
  it('takes two words, or one word\'s first two letters', () => {
    expect(markInitials('DeepSeek V3')).toBe('DV');
    expect(markInitials('company-gateway')).toBe('CG');
    expect(markInitials('mymodel')).toBe('MY');
    expect(markInitials('  ')).toBe('?');
  });
});
