import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RagQueryDtoSchema = z.object({
  query: z.string().min(1, 'Query is required'),
});

export class RagQueryDto extends createZodDto(RagQueryDtoSchema) {}

