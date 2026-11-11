/**
 * What crosses the wire between the clients and the web API. Both ends parse
 * these, so a changed shape breaks the build on both rather than surfacing as
 * a missing value on one.
 */

import { z } from 'zod';

import { LOCALES } from './locales';

/**
 * A failed call. `error` is a stable code a client can branch on, never a
 * sentence it would have to parse; `issues` is present for a request that
 * failed validation.
 */
export const ApiErrorSchema = z.object({
  error: z.string(),
  issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  locale: z.enum(LOCALES).nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const UpdateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80).nullable(),
    locale: z.enum(LOCALES).nullable(),
  })
  .partial();
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;
