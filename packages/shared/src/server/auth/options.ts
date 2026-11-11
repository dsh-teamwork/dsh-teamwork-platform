import type { Identity } from '../../auth';

/** What an app tells either strategy about itself. */
export interface AuthOptions {
  /**
   * Distinct per app. Cookies ignore the port, so on localhost the web app and
   * the console would otherwise overwrite each other's session — and in
   * production they would still collide on a shared parent domain.
   */
  cookieName: string;
  /** Where a completed sign-in lands when the request named nowhere safe. */
  afterSignIn: string;
  /** The app's sign-in page, where a failed provider round-trip is sent back to. */
  signInPath: string;
  /**
   * Whether the email one-time code is offered. The console turns it off: a
   * code is only as strong as the mailbox it lands in, so there Google's own
   * second factor is the only door.
   */
  emailCodes: boolean;
}

/**
 * The identity an app may act on, or null. With `emailCodes` off, only a
 * Google session is somebody: hiding the code form is not enough, since the
 * form of another app on the same identity provider still mints sessions.
 */
export function admitted(options: Pick<AuthOptions, 'emailCodes'>, identity: Identity | null): Identity | null {
  if (!identity) return null;
  return options.emailCodes || identity.via === 'google' ? identity : null;
}

/**
 * Google is a door only where it is configured: a self-hosted instance with no
 * OAuth client offers the emailed code alone, rather than a button that fails.
 */
export function googleConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.AUTH_GOOGLE_ID?.trim() && env.AUTH_GOOGLE_SECRET?.trim());
}
