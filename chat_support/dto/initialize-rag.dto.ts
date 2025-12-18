import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const InitializeRagDtoSchema = z.object({
  url: z.string().url('Invalid URL format').optional(),
  urls: z.array(z.string().url('Invalid URL format')).optional(),
}).refine(
  (data) => data.url || (data.urls && data.urls.length > 0),
  { message: 'Either url or urls must be provided' }
);

export class InitializeRagDto extends createZodDto(InitializeRagDtoSchema) {}

