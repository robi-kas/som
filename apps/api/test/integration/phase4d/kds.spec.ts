import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { getIntegrationFixture } from '../fixture.js';

describe.skip('Phase 4D KDS', () => {
  let fixture: any;
  let app: INestApplication;
  let prisma: PrismaClient;

  let branch1: string;
  let branch2: string;
  let station1: string;
  let station2: string;
  let ticket1Id: string;
  let ticket2Id: string;
  let orderItemId1: string;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    app = fixture.app;
    prisma = fixture.prisma;

    
  const orgObj = await prisma.organization.create({ data: { name: 'Org ' + require('crypto').randomUUID(), slug: 'org-' + require('crypto').randomUUID() } });
  const org = orgObj.id;
    const user = await prisma.user.create({ data: { organizationId: org, username: 'u-' + require('crypto').randomUUID(), passwordHash: 'hash' } });



    const b1 = await prisma.branch.create({ data: { name: 'B1', organizationId: org } });
    const b2 = await prisma.branch.create({ data: { name: 'B2', organizationId: org } });
    branch1 = b1.id;
    branch2 = b2.id;

    const s1 = await prisma.kitchenStation.create({ data: { name: 'Grill', branchId: branch1, organizationId: org, isActive: true } });
    const s2 = await prisma.kitchenStation.create({ data: { name: 'Fryer', branchId: branch1, organizationId: org, isActive: true } });
    station1 = s1.id;
    station2 = s2.id;

    await prisma.userBranch.create({ data: { userId: user.id, branchId: branch1 } });
    await prisma.userBranch.create({ data: { userId: user.id, branchId: branch2 } });

    const table1 = await prisma.table.create({ data: { name: 'T1', branchId: branch1, organizationId: org, capacity: 2 } });
    
    const o1 = await prisma.order.create({
      data: {
        organizationId: org,
        branchId: branch1,
        tableId: table1.id,
        orderNumber: 'KDS-01',
        type: 'DINE_IN',
        subtotal: 10,
        totalAmount: 10, currency: 'ETB',
      }
    });

    const o2 = await prisma.order.create({
      data: {
        organizationId: org,
        branchId: branch2,
        orderNumber: 'KDS-02',
        type: 'TAKEAWAY',
        subtotal: 10,
        totalAmount: 10, currency: 'ETB',
      }
    });

    const t1 = await prisma.kitchenTicket.create({
      data: {
        organizationId: org,
        branchId: branch1,
        orderId: o1.id,
        stationId: station1,
        ticketType: 'FOOD',
        fireBatchNumber: 1,
        status: 'PENDING'
      }
    });
    ticket1Id = t1.id;

    const t2 = await prisma.kitchenTicket.create({
      data: {
        organizationId: org,
        branchId: branch2,
        orderId: o2.id,
        stationId: station1, // Technically cross branch data error if station belongs to branch1, but it's just test data
        ticketType: 'FOOD',
        fireBatchNumber: 1,
        status: 'PENDING'
      }
    });
    ticket2Id = t2.id;

    const t3 = await prisma.kitchenTicket.create({
      data: {
        organizationId: org,
        branchId: branch1,
        orderId: o1.id,
        stationId: station2,
        ticketType: 'FOOD',
        fireBatchNumber: 1,
        status: 'PENDING'
      }
    });

    const oi = await prisma.orderItem.create({
      data: {
        organizationId: org,
        branchId: branch1,
        orderId: o1.id,
        kitchenTicketId: t1.id,
        productId: 'p1',
        quantity: 1,
        status: 'PENDING',
        productNameSnapshot: 'Burger',
        unitPriceSnapshot: 10
      }
    });
    orderItemId1 = oi.id;

    await prisma.permission.create({ data: { code: 'kds.view', description: '' } }).catch(() => {});
    await prisma.permission.create({ data: { code: 'kds.update', description: '' } }).catch(() => {});
    console.log(['kds.view', 'kds.update']);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  it('GET /kitchen/tickets filters by branch', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/kitchen/tickets?branchId=${branch1}`)
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(200);

    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBe(2);
    const orderNumbers = res.body.map((t: any) => t.orderNumber);
    expect(orderNumbers).toContain('KDS-01');
    expect(orderNumbers).not.toContain('KDS-02');
  });

  it('GET /kitchen/tickets station filter works', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/kitchen/tickets?branchId=${branch1}&stationId=${station1}`)
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(200);

    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBe(1);
    expect(res.body[0].stationId).toBe(station1);
  });

  it('POST /kitchen/tickets/:id/acknowledge transitions status + 409 on second call', async () => {
    const res1 = await request(app.getHttpServer())
      .post(`/api/v1/kitchen/tickets/${ticket1Id}/acknowledge`)
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(201);
    
    expect(res1.body.status).toBe('PREPARING');

    const res2 = await request(app.getHttpServer())
      .post(`/api/v1/kitchen/tickets/${ticket1Id}/acknowledge`)
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(409);
    
    expect(res2.body.message).toBe('TICKET_ALREADY_ACKNOWLEDGED');
  });

  it('POST /kitchen/tickets/:id/ready updates order items', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/kitchen/tickets/${ticket1Id}/ready`)
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(201);
    
    expect(res.body.status).toBe('READY');

    const item = await prisma.orderItem.findUnique({ where: { id: orderItemId1 } });
    expect(item?.status).toBe('READY');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'KITCHEN_TICKET_READY', entityId: ticket1Id }
    });
    expect(audit).not.toBeNull();
  });
});
