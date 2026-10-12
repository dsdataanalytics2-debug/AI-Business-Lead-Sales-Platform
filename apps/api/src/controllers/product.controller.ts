import { Request, Response, NextFunction } from 'express';
import {
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema
} from '@leadmate/shared';
import { productService } from '../services/product.service.js';

export class ProductController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createProductSchema.parse(req.body);
      const product = await productService.createProduct(input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(201).json({
        data: product
      });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const product = await productService.getProductById(id, req.user!.organizationId);

      res.status(200).json({
        data: product
      });
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = listProductsQuerySchema.parse(req.query);
      const result = await productService.listProducts(query, req.user!.organizationId);

      res.status(200).json({
        data: result.products,
        meta: {
          total: result.total,
          page: result.page,
          totalPages: result.totalPages
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const input = updateProductSchema.parse(req.body);
      const updated = await productService.updateProduct(id, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: updated
      });
    } catch (err) {
      next(err);
    }
  }
}

export const productController = new ProductController();
