/**
 * Runs once as the server starts. Where the instance holds passwords and no
 * account exists yet, it prints the link that claims the first one (ADR 0006):
 * the server's own output is the one place only its operator reads.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { strategy } = await import('./lib/auth/strategy');
  if (!strategy.passwords || !process.env.AUTH_SECRET) return;
  const { setupOpen, setupToken } = await import('@dsh-teamwork/shared/server/passwords');
  const { siteOrigin } = await import('./lib/site');
  try {
    if (await setupOpen()) {
      console.info(`[setup] No account exists yet. Create the first one at ${siteOrigin()}/setup?token=${setupToken()}`);
    }
  } catch (error) {
    // A database that cannot answer yet is not a reason to keep the server down.
    console.error('[setup] could not check for a first account', error instanceof Error ? error.message : error);
  }
}
