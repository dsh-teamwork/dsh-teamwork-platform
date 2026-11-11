// Auth.js's own endpoints under the NextAuth strategy. `pnpm rename` deletes
// this directory when a product keeps Supabase.
import { nextAuth } from '@/lib/auth/nextauth';

export const { GET, POST } = nextAuth.handlers;
