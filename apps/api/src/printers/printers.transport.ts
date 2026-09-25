import { Injectable } from '@nestjs/common';
import * as net from 'net';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PrinterTransport {
  send(printerId: string, payload: Buffer): Promise<void>;
}

export const PRINTER_TRANSPORT = 'PRINTER_TRANSPORT';

/** Opens a raw TCP connection to the printer (port 9100) and writes the ESC/POS bytes. */
export function sendToPrinter(host: string, port: number, data: Buffer, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error(`Printer ${host}:${port} timed out`)));
    socket.once('error', fail);
    socket.once('connect', () => socket.end(data, () => resolve()));
  });
}

/**
 * Direct mode (PRINT_MODE=direct): the API itself is on the cafe network and prints.
 * In the default agent mode this transport is unused; the print agent claims jobs instead.
 */
@Injectable()
export class NetworkPrinterTransport implements PrinterTransport {
  constructor(private readonly prisma: PrismaService) {}

  async send(printerId: string, payload: Buffer): Promise<void> {
    const printer = await this.prisma.printer.findUniqueOrThrow({ where: { id: printerId } });
    if (!printer.ipAddress) throw new Error(`Printer ${printer.name} has no IP address`);
    await sendToPrinter(printer.ipAddress, printer.port, payload);
  }
}
