/**
 * Team rules against a real database: what a mocked Prisma cannot show —
 * unique indexes, transactions and two requests racing for one row. PGlite in
 * memory without DATABASE_URL, Postgres with it; CI runs both.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/strategy', () => ({ strategy: { identity: async () => null } }));

const { prisma } = await import('@/lib/prisma');
const team = await import('../team');

const suffix = randomUUID();
/** Every team this file makes, so cleanup touches nothing else in a shared database. */
const made: string[] = [];

async function makeUser(label: string) {
  const email = `${label}-${suffix}@example.test`;
  return (await prisma.user.create({ data: { authId: email, email } })).id;
}

describe('teams against the database', () => {
  let admin: string, member: string, outsider: string, teamId: string;
  const model = { kind: 'model', name: 'Protected', data: { provider: 'deepseek', model: 'chat' } } as const;

  beforeAll(async () => {
    [admin, member, outsider] = await Promise.all(['admin', 'member', 'outsider'].map(makeUser));
    teamId = (await team.createTeam(admin, { name: 'Test team' })).id;
    made.push(teamId);
  });

  afterAll(async () => {
    await prisma.team.deleteMany({ where: { id: { in: made } } });
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
  });

  it('invites a member, who reads but cannot write, until removed', async () => {
    const invite = await team.createInvite(admin);
    await team.redeemInvite(member, { token: invite.token });
    await expect(team.redeemInvite(outsider, { token: invite.token })).rejects.toMatchObject({ code: 'invite_used' });

    await expect(team.createConfig(member, model)).rejects.toMatchObject({ code: 'admin_required' });
    const config = await team.createConfig(admin, model);
    expect((await team.listConfigs(member)).configs.map((c) => c.id)).toEqual([config.id]);
    await expect(team.listConfigs(outsider)).rejects.toMatchObject({ code: 'no_team' });

    await team.updateConfig(admin, config.id, { ...model, name: 'Protected v2', version: 1 });
    await expect(team.updateConfig(admin, config.id, { ...model, version: 1 })).rejects.toMatchObject({ code: 'config_conflict' });
    await expect(team.createConfig(admin, { ...model, name: 'Protected v2' })).rejects.toMatchObject({ code: 'config_exists' });

    await expect(team.leaveTeam(admin)).rejects.toMatchObject({ code: 'admin_cannot_leave' });
    await team.removeMember(admin, member);
    await expect(team.listConfigs(member)).rejects.toMatchObject({ code: 'no_team' });
  });

  it('keeps another team admin away from this team’s configuration', async () => {
    const own = await team.createConfig(admin, { ...model, name: 'Isolated' });
    made.push((await team.createTeam(outsider, { name: 'Other team' })).id);
    await expect(team.updateConfig(outsider, own.id, { ...model, name: 'Hijacked', version: 1 })).rejects.toMatchObject({ code: 'config_conflict' });
    await team.deleteConfig(outsider, own.id);
    expect((await prisma.teamConfig.findUnique({ where: { id: own.id } }))?.name).toBe('Isolated');
    expect((await team.listConfigs(outsider)).configs).toEqual([]);
  });

  it('admits exactly one of two people racing for one invitation, and none for a revoked one', async () => {
    const [a, b, c] = await Promise.all(['race-a', 'race-b', 'race-c'].map(makeUser));
    const invite = await team.createInvite(admin);
    const results = await Promise.allSettled([a, b].map((id) => team.redeemInvite(id, { token: invite.token })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const revoked = await team.createInvite(admin);
    await team.revokeInvite(admin, revoked.id);
    await expect(team.redeemInvite(c, { token: revoked.token })).rejects.toMatchObject({ code: 'invite_invalid' });
  });

  it('checks admin rights and team on the same membership row it acts on', async () => {
    const user = await makeUser('switch');
    const other = await prisma.team.create({ data: { name: 'New team' } });
    made.push(other.id);
    await prisma.membership.create({ data: { userId: user, teamId, role: 'member' } });
    const find = prisma.membership.findUnique.bind(prisma.membership);
    const spy = vi.spyOn(prisma.membership, 'findUnique').mockImplementationOnce((async (args: Parameters<typeof find>[0]) => {
      const before = await find(args);
      await prisma.membership.update({ where: { userId: user }, data: { teamId: other.id, role: 'admin' } });
      return before;
    }) as never);
    try {
      await expect(team.createConfig(user, { ...model, name: 'Race escalation' })).rejects.toMatchObject({ code: 'admin_required' });
      expect(await prisma.teamConfig.count({ where: { name: 'Race escalation' } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses a preset whose model or plugin pin is not this team’s, at that version', async () => {
    const plugin = await team.createConfig(admin, { kind: 'plugin', name: 'Tool', data: { package: '@a/tool', version: '1.0.0' } });
    const preset = (data: object) => ({ kind: 'preset', name: 'Review', data: { modelConfigId: 'missing', ...data } });
    await expect(team.createConfig(admin, preset({}))).rejects.toMatchObject({ code: 'model_not_found' });
    const target = await team.createConfig(admin, { ...model, name: 'Target' });
    await expect(
      team.createConfig(admin, preset({ modelConfigId: target.id, pluginDependencies: [{ pluginConfigId: plugin.id, version: '2.0.0' }] })),
    ).rejects.toMatchObject({ code: 'plugin_dependency_invalid' });
    const ok = await team.createConfig(admin, preset({ modelConfigId: target.id, pluginDependencies: [{ pluginConfigId: plugin.id, version: '1.0.0' }] }));
    expect(ok.kind).toBe('preset');
  });
});
