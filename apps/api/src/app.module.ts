import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { EventsModule } from './events/events.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ApprovalsModule } from './approvals/approvals.module.js';
import { UsersModule } from './users/users.module.js';
import { StaffModule } from './staff/staff.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ShiftsModule } from './shifts/shifts.module.js';
import { RefundsModule } from './refunds/refunds.module.js';
import { ReceiptsModule } from './receipts/receipts.module.js';
import { MenuModule } from './menu/menu.module.js';
import { KitchenModule } from './kitchen/kitchen.module.js';
import { TablesModule } from './tables/tables.module.js';
import { PrintersModule } from './printers/printers.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SyncModule } from './sync/sync.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { HealthController } from './health/health.controller.js';
import { AdminModule } from './admin/admin.module.js';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL_MS ?? '60000'),
        // Per client IP. All devices in the cafe usually share one IP, so keep this generous.
        limit: parseInt(process.env.THROTTLE_LIMIT ?? '2000'),
      },
    ]),
    PrismaModule,
    EventsModule,
    AuthModule,
    ApprovalsModule,
    UsersModule,
    StaffModule,
    OrdersModule,
    PaymentsModule,
    ShiftsModule,
    RefundsModule,
    ReceiptsModule,
    MenuModule,
    KitchenModule,
    TablesModule,
    PrintersModule,
    ReportsModule,
    SyncModule,
    UploadsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
