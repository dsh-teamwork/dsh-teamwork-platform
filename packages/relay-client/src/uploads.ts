/** What a computer says about file uploads, and what a finished upload gives back (`teamwork/upload*`, docs/tech/relay.md). */
import { z } from 'zod';

export const UploadLimitsSchema = z.object({
  maxFiles: z.number().int().positive().max(20),
  maxFileBytes: z.number().int().positive(),
  maxMessageBytes: z.number().int().positive(),
  chunkBytes: z
    .number()
    .int()
    .positive()
    .max(256 * 1024),
  extensions: z.array(z.string()),
  maxImageBytes: z.number().int().positive().optional(),
  maxMessageImageBytes: z.number().int().positive().optional(),
});
export type UploadLimits = z.infer<typeof UploadLimitsSchema>;
export interface UploadedFile {
  uploadId: string;
  receiptId: string;
  file: { attachmentId: string; name: string; bytes: number };
}
