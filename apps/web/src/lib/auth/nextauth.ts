import 'server-only';

import { createNextAuth } from '@dsh-teamwork/shared/server/nextauth';

/** This app under the NextAuth strategy. */
export const nextAuth = createNextAuth({
  cookieName: 'dsh-teamwork-web-auth',
  afterSignIn: '/team',
  signInPath: '/sign-in',
  emailCodes: true,
});
