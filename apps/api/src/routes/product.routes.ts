import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { productController } from '../controllers/product.controller.js';

export const productRouter = Router();

// GET /api/v1/products -> List products
productRouter.get(
  '/',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  productController.list
);

// POST /api/v1/products -> Create manual product
productRouter.post(
  '/',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  productController.create
);

// GET /api/v1/products/:id -> Get product details
productRouter.get(
  '/:id',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  productController.getById
);

// PATCH /api/v1/products/:id -> Update product
productRouter.patch(
  '/:id',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  productController.update
);
