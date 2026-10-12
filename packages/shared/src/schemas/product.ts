import { z } from 'zod';
import { ProductSourceType, ProductStatus, SalesPriority } from '../enums.js';

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(200, 'Name must be 200 characters or fewer'),
  description: z.string().trim().min(1, 'Product description is required').max(2000, 'Description must be 2000 characters or fewer'),
  category: z.string().trim().max(100).optional().nullable(),
  sku: z.string().trim().max(100).optional().nullable(),
  stockQuantity: z.coerce.number().int().min(0, 'Stock quantity cannot be negative').default(0),
  sellingPrice: z.coerce.number().min(0).optional().nullable(),
  costPrice: z.coerce.number().min(0).optional().nullable(),
  currency: z.string().trim().max(10).default('BDT'),
  minimumOrderQuantity: z.coerce.number().int().min(1).optional().nullable(),
  brand: z.string().trim().max(100).optional().nullable(),
  imageUrl: z.string().trim().max(1000).optional().nullable(),
  productUrl: z.string().trim().max(1000).optional().nullable(),
  importedFrom: z.string().trim().max(100).optional().nullable(),
  targetMarket: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  status: z.nativeEnum(ProductStatus).default(ProductStatus.ACTIVE),
  salesPriority: z.nativeEnum(SalesPriority).default(SalesPriority.NORMAL)
});

export type CreateProductInput = z.input<typeof createProductSchema>;
export type CreateProductParsed = z.output<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.input<typeof updateProductSchema>;
export type UpdateProductParsed = z.output<typeof updateProductSchema>;

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  salesPriority: z.nativeEnum(SalesPriority).optional()
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export interface ProductDto {
  id: string;
  organizationId: string;
  createdByUserId?: string | null;
  sourceType: ProductSourceType | string;
  sourceProvider?: string | null;
  externalProductId?: string | null;
  sku?: string | null;
  name: string;
  description: string;
  category?: string | null;
  stockQuantity: number;
  sellingPrice?: number | null;
  costPrice?: number | null;
  currency: string;
  minimumOrderQuantity?: number | null;
  brand?: string | null;
  imageUrl?: string | null;
  productUrl?: string | null;
  importedFrom?: string | null;
  targetMarket?: string | null;
  notes?: string | null;
  status: ProductStatus | string;
  salesPriority: SalesPriority | string;
  lastSyncedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}
