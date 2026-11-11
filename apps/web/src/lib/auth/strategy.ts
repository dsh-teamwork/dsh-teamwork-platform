/**
 * Which sign-in strategy this app runs: the one line `pnpm rename` rewrites
 * (to `export { nextAuth as strategy } from './nextauth'`) when a product keeps
 * NextAuth, before deleting everything the other strategy owns. Nothing else
 * in the app decides between them.
 */
export { nextAuth as strategy } from './nextauth';
