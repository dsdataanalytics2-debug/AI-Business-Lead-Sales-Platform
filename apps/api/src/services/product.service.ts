/**
 * Product Catalog Service
 *
 * Provides tenant-isolated CRUD operations and inventory tracking
 * for manually created and API-synced products.
 */

import prisma, { Prisma } from '@leadmate/db';
import {
  type CreateProductInput,
  type UpdateProductInput,
  type ListProductsQuery,
  type ProductDto,
  ProductSourceType,
  ProductStatus,
  SalesPriority
} from '@leadmate/shared';
import { NotFoundError, BadRequestError } from '../lib/errors.js';

export interface ProductRequestContext {
  organizationId: string;
  userId: string;
  correlationId?: string;
}

export class ProductService {
  /**
   * Serializes a Prisma Product record to safe ProductDto.
   */
  private serializeProduct(p: any): ProductDto {
    return {
      id: p.id,
      organizationId: p.organizationId,
      createdByUserId: p.createdByUserId,
      sourceType: p.sourceType,
      sourceProvider: p.sourceProvider,
      externalProductId: p.externalProductId,
      sku: p.sku,
      name: p.name,
      description: p.description,
      category: p.category,
      stockQuantity: p.stockQuantity,
      sellingPrice: p.sellingPrice ? Number(p.sellingPrice) : null,
      costPrice: p.costPrice ? Number(p.costPrice) : null,
      currency: p.currency,
      minimumOrderQuantity: p.minimumOrderQuantity,
      brand: p.brand,
      imageUrl: p.imageUrl,
      productUrl: p.productUrl,
      importedFrom: p.importedFrom,
      targetMarket: p.targetMarket,
      notes: p.notes,
      status: p.status,
      salesPriority: p.salesPriority,
      lastSyncedAt: p.lastSyncedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    };
  }

  /**
   * Creates a new manual product in the catalog.
   */
  async createProduct(
    input: CreateProductInput,
    context: ProductRequestContext
  ): Promise<ProductDto> {
    const trimmedName = input.name.trim();
    const trimmedDesc = input.description.trim();

    if (!trimmedName || !trimmedDesc) {
      throw new BadRequestError('Product name and description are required');
    }

    const created = await prisma.product.create({
      data: {
        organizationId: context.organizationId,
        createdByUserId: context.userId,
        sourceType: ProductSourceType.MANUAL,
        sku: input.sku?.trim() || null,
        name: trimmedName,
        description: trimmedDesc,
        category: input.category?.trim() || null,
        stockQuantity: input.stockQuantity ?? 0,
        sellingPrice: input.sellingPrice != null ? new Prisma.Decimal(input.sellingPrice) : null,
        costPrice: input.costPrice != null ? new Prisma.Decimal(input.costPrice) : null,
        currency: input.currency?.trim() || 'BDT',
        minimumOrderQuantity: input.minimumOrderQuantity ?? null,
        brand: input.brand?.trim() || null,
        imageUrl: input.imageUrl?.trim() || null,
        productUrl: input.productUrl?.trim() || null,
        importedFrom: input.importedFrom?.trim() || null,
        targetMarket: input.targetMarket?.trim() || null,
        notes: input.notes?.trim() || null,
        status: input.status || ProductStatus.ACTIVE,
        salesPriority: input.salesPriority || SalesPriority.NORMAL
      }
    });

    try {
      await prisma.auditLog.create({
        data: {
          organizationId: context.organizationId,
          userId: context.userId,
          action: 'product.created',
          entityType: 'Product',
          entityId: created.id,
          after: {
            name: created.name,
            stockQuantity: created.stockQuantity,
            sellingPrice: created.sellingPrice ? Number(created.sellingPrice) : null
          }
        }
      });
    } catch {
      // Non-blocking
    }

    return this.serializeProduct(created);
  }

  /**
   * Retrieves a product by ID, strictly scoped to caller's tenant.
   */
  async getProductById(id: string, organizationId: string): Promise<ProductDto> {
    const product = await prisma.product.findFirst({
      where: {
        id,
        organizationId
      }
    });

    if (!product) {
      throw new NotFoundError(`Product "${id}" not found`);
    }

    return this.serializeProduct(product);
  }

  /**
   * Lists products with pagination, search, and category filtering.
   */
  async listProducts(
    query: ListProductsQuery,
    organizationId: string
  ): Promise<{
    products: ProductDto[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      organizationId
    };

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } }
      ];
    }

    if (query.category?.trim()) {
      where.category = { equals: query.category.trim(), mode: 'insensitive' };
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.salesPriority) {
      where.salesPriority = query.salesPriority;
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }]
      }),
      prisma.product.count({ where })
    ]);

    return {
      products: products.map((p) => this.serializeProduct(p)),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  /**
   * Updates an existing product.
   */
  async updateProduct(
    id: string,
    input: UpdateProductInput,
    context: ProductRequestContext
  ): Promise<ProductDto> {
    const existing = await prisma.product.findFirst({
      where: {
        id,
        organizationId: context.organizationId
      }
    });

    if (!existing) {
      throw new NotFoundError(`Product "${id}" not found`);
    }

    const data: Prisma.ProductUpdateInput = {};

    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description.trim();
    if (input.category !== undefined) data.category = input.category ? input.category.trim() : null;
    if (input.sku !== undefined) data.sku = input.sku ? input.sku.trim() : null;
    if (input.stockQuantity !== undefined) data.stockQuantity = input.stockQuantity;
    if (input.sellingPrice !== undefined) {
      data.sellingPrice = input.sellingPrice != null ? new Prisma.Decimal(input.sellingPrice) : null;
    }
    if (input.costPrice !== undefined) {
      data.costPrice = input.costPrice != null ? new Prisma.Decimal(input.costPrice) : null;
    }
    if (input.currency !== undefined) data.currency = input.currency.trim();
    if (input.minimumOrderQuantity !== undefined) data.minimumOrderQuantity = input.minimumOrderQuantity;
    if (input.brand !== undefined) data.brand = input.brand ? input.brand.trim() : null;
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl ? input.imageUrl.trim() : null;
    if (input.productUrl !== undefined) data.productUrl = input.productUrl ? input.productUrl.trim() : null;
    if (input.importedFrom !== undefined) data.importedFrom = input.importedFrom ? input.importedFrom.trim() : null;
    if (input.targetMarket !== undefined) data.targetMarket = input.targetMarket ? input.targetMarket.trim() : null;
    if (input.notes !== undefined) data.notes = input.notes ? input.notes.trim() : null;
    if (input.status !== undefined) data.status = input.status;
    if (input.salesPriority !== undefined) data.salesPriority = input.salesPriority;

    const updated = await prisma.product.update({
      where: { id },
      data
    });

    try {
      await prisma.auditLog.create({
        data: {
          organizationId: context.organizationId,
          userId: context.userId,
          action: 'product.updated',
          entityType: 'Product',
          entityId: id,
          before: {
            name: existing.name,
            stockQuantity: existing.stockQuantity
          },
          after: {
            name: updated.name,
            stockQuantity: updated.stockQuantity
          }
        }
      });
    } catch {
      // Non-blocking
    }

    return this.serializeProduct(updated);
  }
}

export const productService = new ProductService();
