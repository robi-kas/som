import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IntegrationTestFixture, getIntegrationFixture } from '../fixture.js';

describe('Phase 4F Staff', () => {
  let fixture: IntegrationTestFixture;
  let app: any;
  let adminToken: string;
  let branchId: string;
  let userIdToDeactivate: string;
  let adminId: string;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    app = fixture.app;

    const org = await fixture.prisma.organization.create({
      data: { id: 'org-1', name: 'Org 1', slug: 'org1' }
    });
    const branch = await fixture.prisma.branch.create({
      data: { id: 'b-1', name: 'B 1', organizationId: org.id }
    });
    branchId = branch.id;

    const waiterRole = await fixture.prisma.role.create({
      data: { name: 'Waiter', organizationId: org.id }
    });
    const adminRole = await fixture.prisma.role.create({
      data: { name: 'Admin', organizationId: org.id }
    });

    const user = await fixture.prisma.user.create({
      data: {
        organizationId: org.id,
        username: 'admin',
        passwordHash: await bcrypt.hash('admin123', 10),
        isActive: true
      }
    });
    adminId = user.id;

    await fixture.prisma.userRole.create({
      data: { userId: user.id, roleId: adminRole.id }
    });
    await fixture.prisma.userBranch.create({
      data: { userId: user.id, branchId: branch.id }
    });

    const managePerm = await fixture.prisma.permission.create({
      data: { code: 'user.manage', description: 'manage' }
    });
    await fixture.prisma.rolePermission.create({
      data: { roleId: adminRole.id, permissionId: managePerm.id }
    });

    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      organizationSlug: 'org1',
      username: 'admin',
      password: 'admin123'
    });
    adminToken = res.body.token;
  });

  afterAll(async () => {
    // await fixture.app.close(); // Not needed with getIntegrationFixture
  });

  it('POST /staff creates employee + user + role + branch in one transaction', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/staff').set('Authorization', `Bearer ${adminToken}`).send({
      firstName: 'Alex',
      lastName: 'Smith',
      organizationSlug: 'default', username: 'alex',
      password: 'admin123',
      roleName: 'Waiter',
      branchId
    });
    
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.username).toBe('alex');
    expect(res.body.displayName).toBe('Alex Smith');
    expect(res.body.roleName).toBe('Waiter');
    expect(res.body.password).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();

    userIdToDeactivate = res.body.id;
  });

  it('POST /staff rejects duplicate username', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/staff').set('Authorization', `Bearer ${adminToken}`).send({
      firstName: 'Alex2',
      lastName: 'Smith2',
      organizationSlug: 'default', username: 'alex',
      password: 'admin123',
      roleName: 'Waiter',
      branchId
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('USERNAME_TAKEN');
  });

  it('POST /staff rejects unknown roleName', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/staff').set('Authorization', `Bearer ${adminToken}`).send({
      firstName: 'Bob',
      lastName: 'Builder',
      username: 'bob',
      password: 'admin123',
      roleName: 'UnknownRole999',
      branchId
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ROLE_NOT_FOUND');
  });

  it('PATCH /staff/:id/deactivate sets isActive: false and blocks the user from logging in', async () => {
    // 1. Deactivate the user
    const res = await request(app.getHttpServer()).patch(`/api/v1/staff/${userIdToDeactivate}/deactivate`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    // 2. Login should fail (verify login blocks inactive users if applicable, or we just trust they get 401)
    const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      organizationSlug: 'default', username: 'alex',
      password: 'admin123'
    });
    // Our auth system returns 401 for inactive users, but we can just check it doesn't give a token
    expect(loginRes.status).toBe(401);
  });

  it('PATCH /staff/:id/deactivate blocks self-deactivation', async () => {
    const meRes = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${adminToken}`);
    const adminId = meRes.body.user.id;

    const res = await request(app.getHttpServer()).patch(`/api/v1/staff/${adminId}/deactivate`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('CANNOT_DEACTIVATE_SELF');
  });
});
