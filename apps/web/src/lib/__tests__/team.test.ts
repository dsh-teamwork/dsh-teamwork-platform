/**
 * Team rules against a real database: what a mocked Prisma cannot show —
 * unique indexes, transactions and two requests racing for one row. PGlite in
 * memory without DATABASE_URL, Postgres with it; CI runs both.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// No SMTP here, so the instance holds passwords and admins create accounts (ADR 0006).
vi.mock('@/lib/auth/strategy', () => ({ strategy: { identity: async () => null, passwords: true } }));

process.env.AUTH_SECRET ??= 'test-secret-that-is-long-enough-for-a-key';
process.env.PROVIDER_KEYS_SECRET = Buffer.alloc(32, 3).toString('base64');
const { prisma } = await import('@/lib/prisma');
const team = await import('../team');
const { checkPassword } = await import('@dsh-teamwork/shared/server/passwords');

const suffix = randomUUID();
/** A public address by literal IP, so the network rule needs no DNS (RFC 5737's documentation range). */
const PROVIDER = { name: 'deepseek', baseUrl: 'https://203.0.113.10/v1', apiKey: 'sk-test' };
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
    await team.createProvider(admin, teamId, PROVIDER);
  });

  afterAll(async () => {
    await prisma.team.deleteMany({ where: { id: { in: made } } });
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
  });

  it('invites a member, who reads but cannot write, until removed', async () => {
    const invite = await team.createInvite(admin, teamId);
    await team.redeemInvite(member, { token: invite.token });
    await expect(team.redeemInvite(outsider, { token: invite.token })).rejects.toMatchObject({ code: 'invite_used' });

    await expect(team.createConfig(member, teamId, model)).rejects.toMatchObject({ code: 'admin_required' });
    const config = await team.createConfig(admin, teamId, model);
    expect((await team.listConfigs(member, teamId)).map((c) => c.id)).toEqual([config.id]);
    expect((await team.teamOf(member, teamId)).role).toBe('member');
    await expect(team.listConfigs(outsider, teamId)).rejects.toMatchObject({ status: 404, code: 'team_not_found' });

    await team.updateConfig(admin, teamId, config.id, { ...model, name: 'Protected v2', version: 1 });
    await expect(team.updateConfig(admin, teamId, config.id, { ...model, version: 1 })).rejects.toMatchObject({ code: 'config_conflict' });
    await expect(team.createConfig(admin, teamId, { ...model, name: 'Protected v2' })).rejects.toMatchObject({ code: 'config_exists' });

    await expect(team.leaveTeam(admin, teamId)).rejects.toMatchObject({ code: 'admin_cannot_leave' });
    await team.removeMember(admin, teamId, member);
    await expect(team.listConfigs(member, teamId)).rejects.toMatchObject({ code: 'team_not_found' });
  });

  it('answers a team the caller is not in with the same 404 as one that does not exist', async () => {
    for (const id of [teamId, 'no-such-team']) {
      for (const call of [
        () => team.teamOf(outsider, id),
        () => team.listConfigs(outsider, id),
        () => team.createConfig(outsider, id, { ...model, name: 'Intruder' }),
        () => team.listProviders(outsider, id),
        () => team.createInvite(outsider, id),
        () => team.leaveTeam(outsider, id),
      ]) {
        await expect(call()).rejects.toMatchObject({ status: 404, code: 'team_not_found' });
      }
    }
  });

  it('keeps another team admin away from this team’s configuration', async () => {
    const own = await team.createConfig(admin, teamId, { ...model, name: 'Isolated' });
    const elsewhere = (await team.createTeam(outsider, { name: 'Other team' })).id;
    made.push(elsewhere);
    await team.createProvider(outsider, elsewhere, PROVIDER);
    await expect(team.updateConfig(outsider, elsewhere, own.id, { ...model, name: 'Hijacked', version: 1 })).rejects.toMatchObject({ code: 'config_conflict' });
    await team.deleteConfig(outsider, elsewhere, own.id);
    expect((await prisma.teamConfig.findUnique({ where: { id: own.id } }))?.name).toBe('Isolated');
    expect(await team.listConfigs(outsider, elsewhere)).toEqual([]);
  });

  it('admits exactly one of two people racing for one invitation, and none for a revoked one', async () => {
    const [a, b, c] = await Promise.all(['race-a', 'race-b', 'race-c'].map(makeUser));
    const invite = await team.createInvite(admin, teamId);
    const results = await Promise.allSettled([a, b].map((id) => team.redeemInvite(id, { token: invite.token })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const revoked = await team.createInvite(admin, teamId);
    await team.revokeInvite(admin, teamId, revoked.id);
    await expect(team.redeemInvite(c, { token: revoked.token })).rejects.toMatchObject({ code: 'invite_invalid' });
  });

  it('refuses a preset whose model or plugin pin is not this team’s, at that version', async () => {
    const plugin = await team.createConfig(admin, teamId, { kind: 'plugin', name: 'Tool', data: { package: '@a/tool', version: '1.0.0' } });
    const preset = (data: object) => ({ kind: 'preset', name: 'Review', data: { modelConfigId: 'missing', ...data } });
    await expect(team.createConfig(admin, teamId, preset({}))).rejects.toMatchObject({ code: 'model_not_found' });
    const target = await team.createConfig(admin, teamId, { ...model, name: 'Target' });
    await expect(
      team.createConfig(admin, teamId, preset({ modelConfigId: target.id, pluginDependencies: [{ pluginConfigId: plugin.id, version: '2.0.0' }] })),
    ).rejects.toMatchObject({ code: 'plugin_dependency_invalid' });
    const ok = await team.createConfig(admin, teamId, preset({ modelConfigId: target.id, pluginDependencies: [{ pluginConfigId: plugin.id, version: '1.0.0' }] }));
    expect(ok.kind).toBe('preset');
  });
});

describe('one person in several teams (ADR 0013)', () => {
  let person: string, colleague: string, own: string, joined: string;
  const model = { kind: 'model', name: 'Shared name', data: { provider: 'deepseek', model: 'chat' } } as const;

  beforeAll(async () => {
    [person, colleague] = await Promise.all(['multi-person', 'multi-colleague'].map(makeUser));
    own = (await team.createTeam(person, { name: 'Own team' })).id;
    joined = (await team.createTeam(colleague, { name: 'Joined team' })).id;
    made.push(own, joined);
    const invite = await team.createInvite(colleague, joined);
    await team.redeemInvite(person, { token: invite.token });
    await team.createProvider(person, own, PROVIDER);
    await team.createProvider(colleague, joined, PROVIDER);
  });

  it('lists every team with the role held in each', async () => {
    expect(await team.teamsOf(person)).toEqual([
      { id: own, name: 'Own team', role: 'admin', memberCount: 1 },
      { id: joined, name: 'Joined team', role: 'member', memberCount: 2 },
    ]);
  });

  it('pairs an admin check with the team it acts on, never with another of the person’s teams', async () => {
    await expect(team.createConfig(person, joined, model)).rejects.toMatchObject({ code: 'admin_required' });
    const mine = await team.createConfig(person, own, model);
    expect((await prisma.teamConfig.findUniqueOrThrow({ where: { id: mine.id } })).teamId).toBe(own);
    // Admin of `own` naming a config of `joined`: scoped to `own`, so nothing happens.
    const theirs = await team.createConfig(colleague, joined, model);
    await team.deleteConfig(person, own, theirs.id);
    expect(await prisma.teamConfig.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });

  it('gives the plugin every team, each with its own configuration and role', async () => {
    const snapshot = await team.configSnapshot(person);
    expect(snapshot.teams.map((t) => [t.teamId, t.teamName, t.role])).toEqual([
      [own, 'Own team', 'admin'],
      [joined, 'Joined team', 'member'],
    ]);
    for (const entry of snapshot.teams) {
      const ids = (await prisma.teamConfig.findMany({ where: { teamId: entry.teamId }, select: { id: true } })).map((c) => c.id);
      expect(entry.configs.map((c) => c.id).sort()).toEqual(ids.sort());
    }
    expect((await team.configSnapshot(await makeUser('multi-nobody'))).teams).toEqual([]);
  });

  it('refuses a second seat in the same team and leaves the invitation unspent', async () => {
    const invite = await team.createInvite(colleague, joined);
    await expect(team.redeemInvite(person, { token: invite.token })).rejects.toMatchObject({ code: 'already_in_team' });
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).usedAt).toBeNull();
  });

  it('leaving one team keeps the others', async () => {
    await team.leaveTeam(person, joined);
    expect((await team.teamsOf(person)).map((t) => t.id)).toEqual([own]);
  });
});

describe('accounts an admin creates, where the instance holds passwords', () => {
  let admin: string, teamId: string;

  beforeAll(async () => {
    admin = await makeUser('accounts-admin');
    teamId = (await team.createTeam(admin, { name: 'Accounts team' })).id;
    made.push(teamId);
  });

  it('creates a member with a first password, shown once, that signs in and must be changed', async () => {
    const email = `new-${suffix}@example.test`;
    const added = await team.addMember(admin, teamId, { email: email.toUpperCase() });
    expect(added).toMatchObject({ email, password: expect.stringMatching(/^[\w-]{20}$/) });
    await expect(checkPassword(email, added.password!)).resolves.toEqual({ userId: added.userId, mustChange: true });
    expect((await team.teamOf(added.userId, teamId)).role).toBe('member');
    await expect(team.addMember(admin, teamId, { email })).rejects.toMatchObject({ code: 'member_in_team' });
  });

  it('adds an existing account as it is, keeping its own password, whatever other teams it is in', async () => {
    const email = `existing-${suffix}@example.test`;
    const first = await team.addMember(admin, teamId, { email });
    await team.removeMember(admin, teamId, first.userId);
    const again = await team.addMember(admin, teamId, { email });
    expect(again).toEqual({ userId: first.userId, email, password: null });
    await expect(checkPassword(email, first.password!)).resolves.toMatchObject({ userId: first.userId });

    const otherAdmin = await makeUser('accounts-other-admin');
    const other = (await team.createTeam(otherAdmin, { name: 'Accounts elsewhere' })).id;
    made.push(other);
    expect(await team.addMember(otherAdmin, other, { email })).toEqual({ userId: first.userId, email, password: null });
    expect((await team.teamsOf(first.userId)).map((t) => t.id).sort()).toEqual([teamId, other].sort());
  });

  it('resets only a member of the admin’s own team, and the old password stops working', async () => {
    const email = `reset-${suffix}@example.test`;
    const added = await team.addMember(admin, teamId, { email });
    const reset = await team.resetMemberPassword(admin, teamId, added.userId);
    expect(reset.password).not.toBe(added.password);
    await expect(checkPassword(email, added.password!)).resolves.toEqual({ error: 'invalid_credentials' });
    await expect(checkPassword(email, reset.password)).resolves.toEqual({ userId: added.userId, mustChange: true });

    await expect(team.resetMemberPassword(admin, teamId, admin)).rejects.toMatchObject({ code: 'cannot_reset_self' });
    await expect(team.resetMemberPassword(added.userId, teamId, admin)).rejects.toMatchObject({ code: 'admin_required' });
    const stranger = await makeUser('accounts-stranger');
    await expect(team.resetMemberPassword(admin, teamId, stranger)).rejects.toMatchObject({ code: 'not_a_member' });
    await expect(team.addMember(added.userId, teamId, { email: `x-${suffix}@example.test` })).rejects.toMatchObject({ code: 'admin_required' });
  });

  it('never resets the password of someone also in another team, whose account it would take over there', async () => {
    const victim = await makeUser('accounts-other-team-admin');
    const theirs = (await team.createTeam(victim, { name: 'Accounts victim team' })).id;
    made.push(theirs);
    const added = await team.addMember(admin, teamId, { email: `accounts-other-team-admin-${suffix}@example.test` });
    expect(added.userId).toBe(victim);
    await expect(team.resetMemberPassword(admin, teamId, victim)).rejects.toMatchObject({ status: 403, code: 'member_in_other_team' });
  });
});

describe('a team’s providers', () => {
  let admin: string, member: string, other: string, teamId: string, elsewhere: string;

  beforeAll(async () => {
    [admin, member, other] = await Promise.all(['providers-admin', 'providers-member', 'providers-other'].map(makeUser));
    teamId = (await team.createTeam(admin, { name: 'Providers team' })).id;
    elsewhere = (await team.createTeam(other, { name: 'Providers elsewhere' })).id;
    made.push(teamId, elsewhere);
    await prisma.membership.create({ data: { userId: member, teamId, role: 'member' } });
  });

  it('keeps the key encrypted, bound to the team, and out of every answer', async () => {
    const created = await team.createProvider(admin, teamId, { ...PROVIDER, apiKey: 'sk-secret-value' });
    expect(created).toEqual({ id: expect.any(String), name: 'deepseek', baseUrl: PROVIDER.baseUrl, updatedAt: expect.any(String) });
    const row = await prisma.teamProvider.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.keyCipher).toMatch(/^v1\./);
    expect(row.keyCipher).not.toContain('sk-secret-value');
    expect(JSON.stringify(await team.listProviders(admin, teamId))).not.toContain('sk-secret');
    await expect(team.createProvider(admin, teamId, PROVIDER)).rejects.toMatchObject({ code: 'provider_exists' });

    const { decryptProviderKey } = await import('../provider-keys');
    expect(decryptProviderKey(row.teamId, row.name, row.keyCipher)).toBe('sk-secret-value');
    expect(() => decryptProviderKey('another-team', row.name, row.keyCipher)).toThrow();
  });

  it('is for the admin of the same team only', async () => {
    const [own] = await team.listProviders(admin, teamId);
    await expect(team.listProviders(member, teamId)).rejects.toMatchObject({ code: 'admin_required' });
    await expect(team.createProvider(member, teamId, { ...PROVIDER, name: 'mine' })).rejects.toMatchObject({ code: 'admin_required' });
    await expect(team.updateProvider(other, elsewhere, own.id, { baseUrl: 'https://203.0.113.11/v1' })).rejects.toMatchObject({ code: 'provider_not_configured' });
    await team.deleteProvider(other, elsewhere, own.id);
    expect(await prisma.teamProvider.findUnique({ where: { id: own.id } })).not.toBeNull();
  });

  it('moves an address or replaces the key, keeping the name', async () => {
    const [own] = await team.listProviders(admin, teamId);
    const before = await prisma.teamProvider.findUniqueOrThrow({ where: { id: own.id } });
    const moved = await team.updateProvider(admin, teamId, own.id, { baseUrl: 'https://203.0.113.12/v1' });
    expect(moved).toMatchObject({ name: 'deepseek', baseUrl: 'https://203.0.113.12/v1' });
    expect((await prisma.teamProvider.findUniqueOrThrow({ where: { id: own.id } })).keyCipher).toBe(before.keyCipher);
    await team.updateProvider(admin, teamId, own.id, { baseUrl: 'https://203.0.113.12/v1', apiKey: 'sk-rotated' });
    expect((await prisma.teamProvider.findUniqueOrThrow({ where: { id: own.id } })).keyCipher).not.toBe(before.keyCipher);
  });

  it('refuses an address with credentials, a query, another scheme, or one the network rule forbids', async () => {
    for (const baseUrl of ['https://user:pass@203.0.113.10/v1', 'https://203.0.113.10/v1?key=x', 'ftp://203.0.113.10/v1']) {
      await expect(team.createProvider(admin, teamId, { ...PROVIDER, name: 'bad', baseUrl })).rejects.toThrow();
    }
    for (const baseUrl of ['https://127.0.0.1/v1', 'https://169.254.169.254/v1', 'http://10.0.0.5/v1']) {
      await expect(team.createProvider(admin, teamId, { ...PROVIDER, name: 'bad', baseUrl })).rejects.toMatchObject({ code: 'provider_address_refused' });
    }
  });

  it('is required by a team model, and cannot be removed while one calls it', async () => {
    const model = (provider: string) => ({ kind: 'model', name: `Calls ${provider}`, data: { provider, model: 'chat' } }) as const;
    await expect(team.createConfig(admin, teamId, model('absent'))).rejects.toMatchObject({ code: 'provider_not_configured' });
    const config = await team.createConfig(admin, teamId, model('deepseek'));
    const [own] = await team.listProviders(admin, teamId);
    await expect(team.deleteProvider(admin, teamId, own.id)).rejects.toMatchObject({ code: 'provider_in_use' });
    await team.deleteConfig(admin, teamId, config.id);
    await team.deleteProvider(admin, teamId, own.id);
    expect(await team.listProviders(admin, teamId)).toEqual([]);
  });
});

