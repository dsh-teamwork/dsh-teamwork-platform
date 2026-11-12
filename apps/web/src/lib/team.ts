/**
 * Teams, invitations and team configuration — the rules, written once, that
 * the /api/team routes and the console pages both call. Every function takes
 * the caller's user id and re-reads their membership, so a removed member is
 * refused on their very next request, plugin token or not.
 */

import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { Prisma, type Membership, type TeamConfig } from '@dsh-teamwork/db';
import {
  AddMemberSchema,
  ConfigInputSchema,
  ProviderInputSchema,
  ProviderUpdateSchema,
  CreateTeamSchema,
  RedeemInviteSchema,
  UpdateConfigSchema,
  type AddedMember,
  type ConfigInput,
  type ConfigSnapshot,
  type CreatedInvite,
  type InviteView,
  type ProviderView,
  type ResetPassword,
  type TeamConfigView,
  type TeamErrorCode,
  type TeamView,
} from '@dsh-teamwork/shared';
import { generatePassword, hashPassword, setPassword } from '@dsh-teamwork/shared/server/passwords';

import { strategy } from '@/lib/auth/strategy';
import { prisma } from '@/lib/prisma';
import { encryptProviderKey } from '@/lib/provider-keys';
import { checkProviderAddress } from '@/lib/provider-network';

/** A refusal with a status and a `TEAM_ERRORS` code; `handleRouteError` answers it as `{ error }`. */
export class TeamError extends Error {
  constructor(
    readonly status: number,
    readonly code: TeamErrorCode,
  ) {
    super(code);
    this.name = 'TeamError';
  }
}

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** Run `write`; a unique-index violation becomes `code` instead of a 500. */
async function unique<T>(code: TeamErrorCode, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new TeamError(409, code);
    throw error;
  }
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** The caller's membership; `admin` additionally requires the admin role. */
export async function requireMembership(userId: string, admin = false): Promise<Membership> {
  const row = await prisma.membership.findUnique({ where: { userId } });
  if (!row) throw new TeamError(403, 'no_team');
  if (admin && row.role !== 'admin') throw new TeamError(403, 'admin_required');
  return row;
}

export function toConfigView(row: TeamConfig): TeamConfigView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    data: row.data,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  } as TeamConfigView;
}

/** The caller's team with its members, or null when they are in none. */
export async function teamOf(userId: string): Promise<TeamView | null> {
  const membership = await prisma.membership.findUnique({
    where: { userId },
    include: { team: { include: { members: { include: { user: { select: { email: true } } }, orderBy: { createdAt: 'asc' } } } } },
  });
  if (!membership) return null;
  const { team } = membership;
  return {
    id: team.id,
    name: team.name,
    role: membership.role,
    members: team.members.map((m) => ({ userId: m.userId, email: m.user.email, role: m.role })),
  };
}

export async function createTeam(userId: string, input: unknown) {
  const { name } = CreateTeamSchema.parse(input);
  if (await prisma.membership.findUnique({ where: { userId } })) throw new TeamError(409, 'already_in_team');
  const team = await unique('already_in_team', () =>
    prisma.team.create({ data: { name, members: { create: { userId, role: 'admin' } } } }),
  );
  return { id: team.id, name: team.name };
}

/** A member leaves. The admin cannot: a team never ends up without one. */
export async function leaveTeam(userId: string) {
  const member = await requireMembership(userId);
  if (member.role === 'admin') throw new TeamError(400, 'admin_cannot_leave');
  // Scoped to the row just read: a membership changed since then is not this one.
  await prisma.membership.deleteMany({ where: { userId, teamId: member.teamId, role: 'member' } });
}

export async function removeMember(userId: string, target: string) {
  const admin = await requireMembership(userId, true);
  if (target === userId) throw new TeamError(400, 'cannot_remove_self');
  await prisma.membership.deleteMany({ where: { userId: target, teamId: admin.teamId, role: 'member' } });
}

// ─── Accounts, where the instance holds passwords (ADR 0006) ────────────────

/**
 * An admin adds someone by email. A new account gets a first password, shown
 * once, which its owner must change at first sign-in; an existing account
 * without a team keeps its own. Where the instance sends email, people join
 * by invitation instead.
 */
export async function addMember(userId: string, input: unknown): Promise<AddedMember> {
  if (!strategy.passwords) throw new TeamError(400, 'passwords_off');
  const admin = await requireMembership(userId, true);
  const { email } = AddMemberSchema.parse(input);
  const password = generatePassword();
  const hash = await hashPassword(password);
  return unique('member_in_team', () => prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { authId: email },
      create: { authId: email, email },
      update: {},
      include: { password: true, membership: true },
    });
    if (user.membership) throw new TeamError(409, 'member_in_team');
    if (!user.password) await tx.password.create({ data: { userId: user.id, hash, mustChange: true } });
    await tx.membership.create({ data: { userId: user.id, teamId: admin.teamId, role: 'member' } });
    return { userId: user.id, email, password: user.password ? null : password };
  }));
}

/**
 * An admin replaces a member's password with a new first one, shown once.
 * Only for a member of the admin's own team, and never the admin's own:
 * that one is changed knowing the current password.
 */
export async function resetMemberPassword(userId: string, target: string): Promise<ResetPassword> {
  if (!strategy.passwords) throw new TeamError(400, 'passwords_off');
  const admin = await requireMembership(userId, true);
  if (target === userId) throw new TeamError(400, 'cannot_reset_self');
  const member = await prisma.membership.findFirst({ where: { userId: target, teamId: admin.teamId } });
  if (!member) throw new TeamError(404, 'not_a_member');
  const password = generatePassword();
  await setPassword(target, password, true);
  return { password };
}

// ─── Invitations ────────────────────────────────────────────────────────────

const toInviteView = (i: { id: string; expiresAt: Date; usedAt: Date | null }): InviteView => ({
  id: i.id,
  expiresAt: i.expiresAt.toISOString(),
  usedAt: i.usedAt?.toISOString() ?? null,
});

export async function listInvites(userId: string): Promise<InviteView[]> {
  const admin = await requireMembership(userId, true);
  const rows = await prisma.invite.findMany({ where: { teamId: admin.teamId }, orderBy: { createdAt: 'desc' } });
  return rows.map(toInviteView);
}

export async function createInvite(userId: string): Promise<CreatedInvite> {
  const admin = await requireMembership(userId, true);
  const token = randomBytes(32).toString('base64url');
  const invite = await prisma.invite.create({
    data: { teamId: admin.teamId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  return { ...toInviteView(invite), token };
}

export async function revokeInvite(userId: string, inviteId: string) {
  const admin = await requireMembership(userId, true);
  await prisma.invite.deleteMany({ where: { id: inviteId, teamId: admin.teamId } });
}

/** Spends the invitation and joins its team, atomically: two people racing for one token get one seat. */
export async function redeemInvite(userId: string, input: unknown) {
  const { token } = RedeemInviteSchema.parse(input);
  return unique('already_in_team', () => prisma.$transaction(async (tx) => {
    if (await tx.membership.findUnique({ where: { userId } })) throw new TeamError(409, 'already_in_team');
    const invite = await tx.invite.findUnique({ where: { tokenHash: sha256(token) } });
    if (!invite || invite.expiresAt < new Date()) throw new TeamError(400, 'invite_invalid');
    const claimed = await tx.invite.updateMany({
      where: { id: invite.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (!claimed.count) throw new TeamError(409, 'invite_used');
    await tx.membership.create({ data: { userId, teamId: invite.teamId, role: 'member' } });
    return { teamId: invite.teamId };
  }));
}

// ─── Providers (ADR 0006) ───────────────────────────────────────────────────

const toProviderView = (p: { id: string; name: string; baseUrl: string; updatedAt: Date }): ProviderView => ({
  id: p.id,
  name: p.name,
  baseUrl: p.baseUrl,
  updatedAt: p.updatedAt.toISOString(),
});

/** The team's providers, for its admin. The key is never part of the answer. */
export async function listProviders(userId: string): Promise<ProviderView[]> {
  const admin = await requireMembership(userId, true);
  const rows = await prisma.teamProvider.findMany({ where: { teamId: admin.teamId }, orderBy: { name: 'asc' } });
  return rows.map(toProviderView);
}

/** An admin adds a provider; its address must pass the network rule now, and on every call. */
export async function createProvider(userId: string, body: unknown): Promise<ProviderView> {
  const admin = await requireMembership(userId, true);
  const input = ProviderInputSchema.parse(body);
  await checkProviderAddress(new URL(input.baseUrl));
  const row = await unique('provider_exists', () =>
    prisma.teamProvider.create({
      data: {
        teamId: admin.teamId,
        name: input.name,
        baseUrl: input.baseUrl,
        keyCipher: encryptProviderKey(admin.teamId, input.name, input.apiKey),
      },
    }),
  );
  return toProviderView(row);
}

/** An admin moves a provider or replaces its key. Its name stays: team models refer to it. */
export async function updateProvider(userId: string, providerId: string, body: unknown): Promise<ProviderView> {
  const admin = await requireMembership(userId, true);
  const input = ProviderUpdateSchema.parse(body);
  const row = await prisma.teamProvider.findFirst({ where: { id: providerId, teamId: admin.teamId } });
  if (!row) throw new TeamError(404, 'provider_not_configured');
  await checkProviderAddress(new URL(input.baseUrl));
  const updated = await prisma.teamProvider.update({
    where: { id: row.id },
    data: {
      baseUrl: input.baseUrl,
      ...(input.apiKey ? { keyCipher: encryptProviderKey(admin.teamId, row.name, input.apiKey) } : {}),
    },
  });
  return toProviderView(updated);
}

/** An admin removes a provider no team model or preset still calls. */
export async function deleteProvider(userId: string, providerId: string) {
  const admin = await requireMembership(userId, true);
  const row = await prisma.teamProvider.findFirst({ where: { id: providerId, teamId: admin.teamId } });
  if (!row) return;
  const inUse = await prisma.teamConfig.findFirst({
    where: { teamId: admin.teamId, kind: { in: ['model', 'preset'] }, data: { path: ['provider'], equals: row.name } },
  });
  if (inUse) throw new TeamError(409, 'provider_in_use');
  await prisma.teamProvider.deleteMany({ where: { id: row.id, teamId: admin.teamId } });
}

// ─── Configuration ──────────────────────────────────────────────────────────

export async function listConfigs(userId: string): Promise<ConfigSnapshot> {
  const member = await requireMembership(userId);
  const rows = await prisma.teamConfig.findMany({ where: { teamId: member.teamId }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] });
  return { teamId: member.teamId, configs: rows.map(toConfigView) };
}

/** What a configuration may reference has to exist in the same team, at the pinned version. */
async function checkReferences(teamId: string, input: ConfigInput) {
  if (input.kind === 'plugin') return;
  if (input.data.contextWindow && input.data.maxTokens && input.data.maxTokens > input.data.contextWindow) {
    throw new TeamError(400, 'max_tokens_exceeds_context');
  }
  // A model, or a preset with a model of its own, calls a provider the team has.
  const provider = input.data.provider;
  if (provider && !(await prisma.teamProvider.findUnique({ where: { teamId_name: { teamId, name: provider } } }))) {
    throw new TeamError(400, 'provider_not_configured');
  }
  if (input.kind !== 'preset') return;
  const { modelConfigId, pluginDependencies } = input.data;
  if (modelConfigId && !(await prisma.teamConfig.findFirst({ where: { id: modelConfigId, teamId, kind: 'model' } }))) {
    throw new TeamError(400, 'model_not_found');
  }
  for (const dependency of pluginDependencies) {
    const plugin = await prisma.teamConfig.findFirst({ where: { id: dependency.pluginConfigId, teamId, kind: 'plugin' } });
    if ((plugin?.data as { version?: string } | undefined)?.version !== dependency.version) {
      throw new TeamError(400, 'plugin_dependency_invalid');
    }
  }
}

export async function createConfig(userId: string, body: unknown): Promise<TeamConfigView> {
  const admin = await requireMembership(userId, true);
  const input = ConfigInputSchema.parse(body);
  await checkReferences(admin.teamId, input);
  const row = await unique('config_exists', () =>
    prisma.teamConfig.create({
      data: { teamId: admin.teamId, kind: input.kind, name: input.name, data: input.data as Prisma.InputJsonValue },
    }),
  );
  return toConfigView(row);
}

export async function updateConfig(userId: string, configId: string, body: unknown): Promise<TeamConfigView> {
  const admin = await requireMembership(userId, true);
  const { version, ...input } = UpdateConfigSchema.parse(body);
  await checkReferences(admin.teamId, input as ConfigInput);
  const changed = await unique('config_exists', () =>
    prisma.teamConfig.updateMany({
      where: { id: configId, teamId: admin.teamId, version },
      data: { kind: input.kind, name: input.name, data: input.data as Prisma.InputJsonValue, version: { increment: 1 } },
    }),
  );
  if (!changed.count) throw new TeamError(409, 'config_conflict');
  return toConfigView(await prisma.teamConfig.findUniqueOrThrow({ where: { id: configId } }));
}

export async function deleteConfig(userId: string, configId: string) {
  const admin = await requireMembership(userId, true);
  await prisma.teamConfig.deleteMany({ where: { id: configId, teamId: admin.teamId } });
}
