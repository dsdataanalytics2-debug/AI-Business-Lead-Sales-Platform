import { z } from 'zod';

export const cursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional()
});

export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  total?: number;
}
