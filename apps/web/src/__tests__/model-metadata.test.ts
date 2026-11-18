import { providerMark } from '@dsh-teamwork/shared';
import { expect, it } from 'vitest';

import { catalogEntry, PROVIDER_CATALOG } from '@/lib/provider-catalog';
import { agreedValues, changedValues, completeRates, exactMatches, referenceFrom, suggestedRates, type ModelMetadata } from '@/lib/model-metadata';

it('converts automatically supplied FX to simple rates without floating point drift', () => {
  expect(suggestedRates({ input: '2.5', output: '10', cacheRead: '0' }, '6.6665')).toEqual({ input: '17', output: '67', cacheRead: '0' });
  expect(suggestedRates({ input: '0.035' }, '6.6665')).toEqual({ input: '0.24' });
});

it('retains unknown buckets and never rounds a positive supplier cost to free', () => {
  expect(suggestedRates({}, '7')).toEqual({});
  expect(suggestedRates({ input: '0.000000000001' }, '7')).toEqual({ input: '0.001' });
  expect(suggestedRates({ input: '1' }, '')).toBeNull();
  expect(suggestedRates({ input: '1' }, '0')).toBeNull();
  expect(suggestedRates({ input: '1000000000' }, '7')).toBeNull();
});

it('names each listed provider as Models.dev does, and finds it by address', () => {
  expect(PROVIDER_CATALOG.map((p) => p.id)).toEqual(['deepseek', 'openai', 'alibaba-cn', 'moonshotai-cn', 'zhipuai', 'volcengine', 'minimax-cn', 'siliconflow-cn', 'openrouter']);
  expect(catalogEntry('https://dashscope.aliyuncs.com/compatible-mode/v1/')?.id).toBe('alibaba-cn');
  expect(catalogEntry('https://api.minimaxi.com/v1')?.id).toBe('minimax-cn');
  expect(catalogEntry('https://custom.example/v1')).toBeUndefined();
  // Every listed provider is drawn by its maker's mark, from its Models.dev id alone.
  expect(PROVIDER_CATALOG.map((p) => providerMark(p.id))).toEqual(['deepseek', 'openai', 'qwen', 'kimi', 'zhipu', 'doubao', 'minimax', 'siliconflow', 'openrouter']);
});

it('fills only from exact ids, and from several only when they agree', () => {
  const m = (id: string, provider = 'p'): ModelMetadata => ({ id, name: id, provider, prices: {} });
  expect(exactMatches([m('qwen-max-latest'), m('Qwen-Max')], 'qwen-max ')).toEqual([m('Qwen-Max')]);
  expect(agreedValues([{ contextWindow: 204800, vision: undefined }, { vision: undefined, contextWindow: 204800 }])).toEqual({ contextWindow: 204800, vision: undefined });
  expect(agreedValues([{ contextWindow: 32768 }, { contextWindow: 131072 }])).toBeNull();
  expect(agreedValues([])).toBeNull();
});

it('never counts an unknown or an equal value as a change', () => {
  expect(changedValues<Record<string, number | boolean | undefined>>({ contextWindow: 128000, maxTokens: undefined, vision: false }, { contextWindow: 128000, maxTokens: 8192, vision: undefined })).toEqual({ maxTokens: 8192 });
});

it('saves a reference rate only with an input and an output price, charging a missing cache rate as input', () => {
  expect(completeRates({ input: '2', output: '8' })).toEqual({ input: '2', output: '8', cacheRead: '2', cacheWrite: '2' });
  expect(completeRates({ input: '2', output: '8', cacheRead: '0.2', cacheWrite: '0' })).toEqual({ input: '2', output: '8', cacheRead: '0.2', cacheWrite: '0' });
  expect(completeRates({ input: '2' })).toBeNull();
  expect(completeRates(null)).toBeNull();
});

it('reads a reference only from agreeing exact matches, and prices it only with an exchange rate', () => {
  const m = (provider: string, input: string, contextWindow = 128000): ModelMetadata => ({ id: 'deepseek-chat', name: 'DeepSeek', provider, contextWindow, prices: { input, output: '1.1', cacheRead: '0.07' } });
  expect(referenceFrom([m('deepseek', '0.27')], 'DeepSeek-Chat', '7')).toEqual({
    from: 'deepseek / deepseek-chat',
    details: { contextWindow: 128000, maxTokens: undefined, vision: undefined },
    rates: { input: '1.9', output: '7.7', cacheRead: '0.49', cacheWrite: '1.9' },
  });
  expect(referenceFrom([m('a', '0.27'), m('b', '0.27')], 'deepseek-chat', '7')?.from).toBe('deepseek-chat');
  // Disagreeing prices leave the rate to the admin; agreeing limits are still filled.
  const split = referenceFrom([m('a', '0.27'), m('b', '0.3')], 'deepseek-chat', '7');
  expect(split?.rates).toBeNull();
  expect(split?.details.contextWindow).toBe(128000);
  expect(referenceFrom([m('a', '0.27')], 'deepseek-chat', undefined)?.rates).toBeNull();
  expect(referenceFrom([m('a', '0.27')], 'deepseek-reasoner', '7')).toBeNull();
});
