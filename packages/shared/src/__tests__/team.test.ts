import { describe, expect, it } from 'vitest';

import { ConfigInputSchema, UpdateConfigSchema } from '../team';

const preset = {
  kind: 'preset',
  name: 'Review',
  data: { modelConfigId: 'm', description: 'Review code', requiredTools: ['Read'], optionalTools: ['Shell'], systemPrompt: 'Do not interpolate {{text}}' },
} as const;

describe('ConfigInputSchema', () => {
  it('takes a preset that references a team model, or one with its own route', () => {
    expect(ConfigInputSchema.parse(preset).data).toMatchObject(preset.data);
    expect(ConfigInputSchema.safeParse({ ...preset, data: { provider: 'kimi', model: 'legacy' } }).success).toBe(true);
  });

  it('refuses a preset mixing both routes, or with neither', () => {
    expect(ConfigInputSchema.safeParse({ ...preset, data: { ...preset.data, provider: 'local', model: 'secret' } }).success).toBe(false);
    expect(ConfigInputSchema.safeParse({ ...preset, data: { systemPrompt: 'No model' } }).success).toBe(false);
  });

  it('refuses a tool or a plugin listed twice', () => {
    expect(ConfigInputSchema.safeParse({ ...preset, data: { ...preset.data, optionalTools: ['Read'] } }).success).toBe(false);
    const dependency = { pluginConfigId: 'p1', version: '1.0.0' };
    expect(ConfigInputSchema.safeParse({ ...preset, data: { ...preset.data, pluginDependencies: [dependency, dependency] } }).success).toBe(false);
  });

  it('accepts no field a kind does not declare — no URL or key can ride along', () => {
    expect(ConfigInputSchema.safeParse({ kind: 'model', name: 'm', data: { provider: 'p', model: 'm', apiKey: 'k' } }).success).toBe(false);
    expect(ConfigInputSchema.safeParse({ kind: 'plugin', name: 'p', data: { package: 'x', version: '1.0.0', url: 'https://x' } }).success).toBe(false);
  });

  it('pins a plugin to one exact version', () => {
    expect(ConfigInputSchema.safeParse({ kind: 'plugin', name: 'p', data: { package: '@a/b', version: '^1.0.0' } }).success).toBe(false);
    expect(ConfigInputSchema.safeParse({ kind: 'plugin', name: 'p', data: { package: '@a/b', version: '1.0.0-rc.1' } }).success).toBe(true);
  });

  it('makes an edit name the version it was made against', () => {
    expect(UpdateConfigSchema.safeParse(preset).success).toBe(false);
    expect(UpdateConfigSchema.safeParse({ ...preset, version: 1 }).success).toBe(true);
  });
});
