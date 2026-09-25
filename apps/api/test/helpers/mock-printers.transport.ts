import { Injectable } from '@nestjs/common';
import { PrinterTransport } from './printers.transport.js';

@Injectable()
export class MockPrinterTransport implements PrinterTransport {
  shouldFail = false;
  
  async send(printerId: string, payload: Buffer): Promise<void> {
    if (this.shouldFail) {
      throw new Error('Mock printer failure');
    }
    return Promise.resolve();
  }
}
