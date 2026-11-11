'use server';

/**
 * The four sign-in actions the shared form calls by name. Thin on purpose:
 * the strategy does the work, and these exist because a server action has to
 * be declared in a `'use server'` module of the app that serves it.
 */

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

export async function signOut() {
  return strategy.signOut();
}

/** The DSH plugin's sign-in: a two-minute code bound to the plugin's PKCE challenge, or null. */
export async function authorizePlugin(challenge: string) {
  return nextAuth.plugin.mint(challenge);
}
