import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { ORGANIZATION_ADMIN_PERMISSION } from '../../src/common/utils/permission-policy.js';

describe('Phase 3B Controllers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let isDbAvailable = false;
  let adminToken: string;
  let branchId: string;
  let orgId: string;
  
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    
    prisma = app.get(PrismaService);
    try {
      await prisma.$queryRaw`SELECT 1`;
      isDbAvailable = true;
    } catch (e) {
      if (process.env.REQUIRE_DATABASE === 'true') {
        throw new Error('PostgreSQL is required for e2e tests but is unreachable.');
      }
    }

    if (isDbAvailable) {
      // Setup test user and session for auth
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      
      const org = await prisma.organization.create({ data: { name: 'E2E Org', slug: 'e2e' } });
      orgId = org.id;
      const branch = await prisma.branch.create({ data: { name: 'E2E Branch', organizationId: org.id } });
      branchId = branch.id;

      const user = await prisma.user.create({ 
        data: { 
          organizationId: org.id, 
          username: 'e2e-admin', 
          passwordHash: await bcrypt.hash('pass', 10),
          permissions: [ORGANIZATION_ADMIN_PERMISSION],
          isActive: true
        } 
      });

      await prisma.session.create({
        data: {
          tokenHash,
          userId: user.id,
          expiresAt: new Date(Date.now() + 1000000)
        }
      });
      adminToken = rawToken;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const e2eTest = it.skipIf(() => !isDbAvailable);

  e2eTest('POST /api/v1/categories (creates category)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'E2E Drinks', branchId });
      
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('E2E Drinks');
    expect(res.body.organizationId).toBeUndefined(); // Verify mapper cleans it
  });

  e2eTest('POST /api/v1/kitchen-stations (creates station)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/kitchen-stations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'E2E Coffee Station', branchId });
      
    expect(res.status).toBe(201);
  });

  e2eTest('POST /api/v1/products (creates product and changes price)', async () => {
    const catRes = await request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'E2E Food', branchId });
    
    const res = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ 
        name: 'E2E Burger', 
        branchId, 
        categoryId: catRes.body.id,
        price: "12.50"
      });
      
    expect(res.status).toBe(201);
    expect(res.body.sellingPrice).toBe("12.50");

    const priceRes = await request(app.getHttpServer())
      .post(`/api/v1/products/${res.body.id}/change-price`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPrice: "14.99", reason: "inflation" });
      
    expect(priceRes.status).toBe(201);
    expect(priceRes.body.sellingPrice).toBe("14.99");
  });

  e2eTest('POST /api/v1/tables (creates table and sets status)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'E2E Table 1', capacity: 4, branchId });
      
    expect(res.status).toBe(201);
    
    const statusRes = await request(app.getHttpServer())
      .post(`/api/v1/tables/${res.body.id}/set-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'OCCUPIED' });
      
    expect(statusRes.status).toBe(201);
    expect(statusRes.body.status).toBe('OCCUPIED');
  });
});
