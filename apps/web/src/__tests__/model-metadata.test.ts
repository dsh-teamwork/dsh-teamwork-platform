import { expect, it } from 'vitest';

import { catalogEntry } from '@/lib/provider-catalog';
import { agreedValues, changedValues, exactMatches, suggestedRates, type ModelMetadata } from '@/lib/model-metadata';

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

it('uses domestic provider namespaces without changing the call address', () => {
  expect(catalogEntry('https://dashscope.aliyuncs.com/compatible-mode/v1')?.modelsDevId).toBe('alibaba-cn');
  expect(catalogEntry('https://api.moonshot.cn/v1')?.modelsDevId).toBe('moonshotai-cn');
  expect(catalogEntry('https://open.bigmodel.cn/api/paas/v4')?.modelsDevId).toBe('zhipuai');
  expect(catalogEntry('https://ark.cn-beijing.volces.com/api/v3')?.modelsDevId).toBe('volcengine');
  expect(catalogEntry('https://api.siliconflow.cn/v1')?.modelsDevId).toBe('siliconflow-cn');
  expect(catalogEntry('https://api.minimaxi.com/v1')?.modelsDevId).toBe('minimax-cn');
  expect(catalogEntry('https://custom.example/v1')).toBeUndefined();
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
