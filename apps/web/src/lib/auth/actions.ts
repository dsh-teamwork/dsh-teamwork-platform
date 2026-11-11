'use server';

/**
 * The sign-in actions the shared form calls by name. Thin on purpose:
 * the strategy does the work, and these exist because a server action has to
 * be declared in a `'use server'` module of the app that serves it.
 */

import { mustChangePassword } from '@dsh-teamwork/shared/server/passwords';

import { currentUser } from './index';
import { nextAuth } from './nextauth';
import { strategy } from './strategy';

export async function startGoogle(next: string) {
  return strategy.startGoogle(next);
}

export async function sendCode(email: string) {
  return strategy.sendCode(email);
}

export async function verifyCode(email: string, code: string, next: string) {
  return strategy.verifyCode(email, code, next);
}

export async function signInWithPassword(email: string, password: string, next: string) {
  return strategy.signInWithPassword(email, password, next);
}

export async function claimSetup(token: string, email: string, password: string) {
  return strategy.claimSetup(token, email, password, '/team');
}

export async function changePassword(current: string, next: string) {
  return strategy.changePassword(current, next);
}

export async function signOut() {
  return strategy.signOut();
}

/**
 * The DSH plugin's sign-in: a two-minute code bound to the plugin's PKCE
 * challenge, or null. Not while an admin-set password is still unchanged: its
 * owner has not yet proved they hold it alone.
 */
export async function authorizePlugin(challenge: string) {
  const user = await currentUser();
  if (user && (await mustChangePassword(user.id))) return null;
  return nextAuth.plugin.mint(challenge);
}
