import { ApiError } from './api';

/** The sign-in failures the messages word (`authErrors.*`). */
export const AUTH_ERRORS = [
  'invalid_email',
  'invalid_code',
  'code_expired',
  'too_many_attempts',
  'not_allowed',
  'unavailable',
  'invalid_credentials',
  'weak_password',
  'setup_closed',
] as const;
export type AuthError = (typeof AUTH_ERRORS)[number];

/** A thrown error as a code the page can word; anything else is `unavailable`. */
export function authError(error: unknown): AuthError {
  const code = error instanceof ApiError ? error.code : '';
  return (AUTH_ERRORS as readonly string[]).includes(code) ? (code as AuthError) : 'unavailable';
}
