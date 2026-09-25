import { Module } from '@nestjs/common';
import { PrinterJobsService } from './printer-jobs.service.js';
import { PrinterJobsController, PrintersAdminController, PrintAgentController } from './printer-jobs.controller.js';
import { PRINTER_TRANSPORT, NetworkPrinterTransport } from './printers.transport.js';
import { AgentAuthGuard } from './agent-auth.guard.js';

@Module({
  controllers: [PrinterJobsController, PrintersAdminController, PrintAgentController],
  providers: [
    PrinterJobsService,
    AgentAuthGuard,
    { provide: PRINTER_TRANSPORT, useClass: NetworkPrinterTransport },
  ],
  exports: [PrinterJobsService, PRINTER_TRANSPORT],
})
export class PrintersModule {}
