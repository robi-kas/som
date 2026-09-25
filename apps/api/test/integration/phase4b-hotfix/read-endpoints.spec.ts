import { IntegrationTestFixture, getIntegrationFixture } from '../fixture.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { TablesService } from '../../../src/tables/tables.service.js';
import { CategoriesService } from '../../../src/menu/categories.service.js';
import { ProductsService } from '../../../src/menu/products.service.js';

describe('Phase 4B Hotfix - Read Endpoints (Integration)', () => {
  let fixture: IntegrationTestFixture;
  let tablesService: TablesService;
  let categoriesService: CategoriesService;
  let productsService: ProductsService;
  
  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    tablesService = fixture.app.get(TablesService);
    categoriesService = fixture.app.get(CategoriesService);
    productsService = fixture.app.get(ProductsService);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  it('GET /tables returns only tables in the caller branch', async () => {
    const orgId = `org-${crypto.randomBytes(4).toString('hex')}`;
    const branch1 = `b1-${crypto.randomBytes(4).toString('hex')}`;
    const branch2 = `b2-${crypto.randomBytes(4).toString('hex')}`;
    
    await fixture.prisma.organization.create({ data: { id: orgId, name: 'Org', slug: orgId } });
    await fixture.prisma.branch.create({ data: { id: branch1, organizationId: orgId, name: 'B1' } });
    await fixture.prisma.branch.create({ data: { id: branch2, organizationId: orgId, name: 'B2' } });

    await fixture.prisma.table.create({ data: { id: crypto.randomUUID(), organizationId: orgId, branchId: branch1, name: 'T1', capacity: 4 } });
    await fixture.prisma.table.create({ data: { id: crypto.randomUUID(), organizationId: orgId, branchId: branch2, name: 'T2', capacity: 4 } });

    const principal = { userId: 'u', sessionId: 's', organizationId: orgId, branchIds: [branch1], permissions: [] };
    const res = await tablesService.findAll(principal as any);
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('T1');
  });

  it('GET /categories rejects cross-org branchId with 403', async () => {
    const principal = { userId: 'u', sessionId: 's', organizationId: crypto.randomUUID(), branchIds: ['b1'], permissions: [] };
    await expect(categoriesService.findAll('b2', principal as any)).rejects.toThrow('No access to this branch');
  });

  it('GET /products filters by categoryId correctly', async () => {
    const orgId = `org-${crypto.randomBytes(4).toString('hex')}`;
    const branchId = `b-${crypto.randomBytes(4).toString('hex')}`;
    await fixture.prisma.organization.create({ data: { id: orgId, name: 'Org', slug: orgId } });
    await fixture.prisma.branch.create({ data: { id: branchId, organizationId: orgId, name: 'B' } });
    
    const cat1 = crypto.randomUUID();
    const cat2 = crypto.randomUUID();
    await fixture.prisma.category.create({ data: { id: cat1, organizationId: orgId, branchId, name: 'C1' } });
    await fixture.prisma.category.create({ data: { id: cat2, organizationId: orgId, branchId, name: 'C2' } });

    await fixture.prisma.product.create({ data: { id: crypto.randomUUID(), organizationId: orgId, branchId, categoryId: cat1, name: 'P1', sellingPrice: 10 } });
    await fixture.prisma.product.create({ data: { id: crypto.randomUUID(), organizationId: orgId, branchId, categoryId: cat2, name: 'P2', sellingPrice: 20 } });

    const principal = { userId: 'u', sessionId: 's', organizationId: orgId, branchIds: [branchId], permissions: [] };
    const res = await productsService.findAll(branchId, cat1, false, principal as any);
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('P1');
  });
});
