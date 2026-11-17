import { expect, it } from 'vitest';

import { catalogEntry } from '@/lib/provider-catalog';
import { suggestedRates } from '@/lib/model-metadata';

it('converts automatically supplied FX to simple rates without floating point drift', () => {
  expect(suggestedRates({ input: '2.5', output: '10', cacheRead: '0' }, '6.6665', '1')).toEqual({ input: '17', output: '67', cacheRead: '0' });
  expect(suggestedRates({ input: '0.035' }, '6.6665', '1')).toEqual({ input: '0.24' });
  expect(suggestedRates({ input: '2.5' }, '6.6665', '1.2')).toEqual({ input: '20' });
});

it('retains unknown buckets and never rounds a positive supplier cost to free', () => {
  expect(suggestedRates({}, '7', '1')).toEqual({});
  expect(suggestedRates({ input: '0.000000000001' }, '7', '1')).toEqual({ input: '0.001' });
  expect(suggestedRates({ input: '1' }, '', '1')).toBeNull();
  expect(suggestedRates({ input: '1' }, '7', '0')).toBeNull();
  expect(suggestedRates({ input: '1000000000' }, '7', '1')).toBeNull();
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
