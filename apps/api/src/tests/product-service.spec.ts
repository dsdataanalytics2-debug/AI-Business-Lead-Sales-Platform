import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '@leadmate/db';
import { productService } from '../services/product.service.js';
import { ProductStatus, SalesPriority } from '@leadmate/shared';

describe('ProductService', () => {
  let orgAlpha: any;
  let orgBeta: any;
  let userAlpha: any;

  beforeEach(async () => {
    // Setup clean isolated test tenant and user
    orgAlpha = await prisma.organization.create({
      data: {
        name: `Org Alpha ${Date.now()}`
      }
    });

    orgBeta = await prisma.organization.create({
      data: {
        name: `Org Beta ${Date.now()}`
      }
    });

    userAlpha = await prisma.user.create({
      data: {
        organizationId: orgAlpha.id,
        email: `user-alpha-${Date.now()}@test.local`,
        passwordHash: 'argon2id$mock',
        name: 'Alpha User',
        role: 'ADMIN'
      }
    });
  });

  it('1. Creates a manual product with all required and optional fields', async () => {
    const product = await productService.createProduct(
      {
        name: 'Diamum',
        description: 'Diabetes-care healthcare supplement for retail and distribution.',
        category: 'Healthcare',
        sku: 'DM-1001',
        stockQuantity: 850,
        sellingPrice: 1250.0,
        costPrice: 800.0,
        currency: 'BDT',
        minimumOrderQuantity: 10,
        brand: 'Diamum Care',
        importedFrom: 'China',
        targetMarket: 'Dhaka, Bangladesh',
        status: ProductStatus.ACTIVE,
        salesPriority: SalesPriority.HIGH
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    expect(product.id).toBeDefined();
    expect(product.organizationId).toBe(orgAlpha.id);
    expect(product.name).toBe('Diamum');
    expect(product.stockQuantity).toBe(850);
    expect(product.sellingPrice).toBe(1250);
    expect(product.costPrice).toBe(800);
    expect(product.salesPriority).toBe('HIGH');
  });

  it('2. Enforces tenant isolation: Product in Org Alpha is not accessible to Org Beta', async () => {
    const created = await productService.createProduct(
      {
        name: 'Mini Blender',
        description: 'USB rechargeable portable blender.',
        stockQuantity: 500,
        status: ProductStatus.ACTIVE,
        salesPriority: SalesPriority.NORMAL,
        currency: 'BDT'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    // Alpha can read
    const fetched = await productService.getProductById(created.id, orgAlpha.id);
    expect(fetched.id).toBe(created.id);

    // Beta cannot read (fails closed with NotFoundError)
    await expect(
      productService.getProductById(created.id, orgBeta.id)
    ).rejects.toThrow('not found');
  });

  it('3. Updates product details and stock quantity', async () => {
    const created = await productService.createProduct(
      {
        name: 'Smart Water Bottle',
        description: 'Temperature display smart bottle.',
        stockQuantity: 200,
        status: ProductStatus.ACTIVE,
        salesPriority: SalesPriority.NORMAL,
        currency: 'BDT'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    const updated = await productService.updateProduct(
      created.id,
      {
        stockQuantity: 180,
        sellingPrice: 750,
        salesPriority: SalesPriority.URGENT
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    expect(updated.stockQuantity).toBe(180);
    expect(updated.sellingPrice).toBe(750);
    expect(updated.salesPriority).toBe('URGENT');
  });

  it('4. Lists and filters products with search query', async () => {
    await productService.createProduct(
      {
        name: 'Kitchen Mini Mop',
        description: 'Hands-free squeegee mop for kitchen surfaces.',
        category: 'Home & Kitchen',
        stockQuantity: 300,
        status: ProductStatus.ACTIVE,
        salesPriority: SalesPriority.NORMAL,
        currency: 'BDT'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    const listResult = await productService.listProducts(
      {
        page: 1,
        limit: 10,
        search: 'Mini Mop'
      },
      orgAlpha.id
    );

    expect(listResult.products.length).toBe(1);
    expect(listResult.products[0].name).toContain('Mini Mop');
  });
});
