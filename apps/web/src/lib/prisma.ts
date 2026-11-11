import { getPrisma } from '@dsh-teamwork/db';

/** The process-wide client. Its pool connects lazily, so importing opens nothing. */
export const prisma = getPrisma();
