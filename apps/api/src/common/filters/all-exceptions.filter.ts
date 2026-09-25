import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Last line of defence for errors nobody handled.
 * - HttpExceptions pass through unchanged (they're deliberate).
 * - Known Prisma errors become sensible 404/409s instead of 500s.
 * - Anything else is logged with a reference id and returned as a bare 500, so stack
 *   traces, SQL and internal ids never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res.status(exception.getStatus()).json(typeof body === 'string' ? { statusCode: exception.getStatus(), message: body } : body);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Not found' });
        return;
      }
      if (exception.code === 'P2002') {
        res.status(HttpStatus.CONFLICT).json({ statusCode: 409, code: 'DUPLICATE', message: 'That already exists' });
        return;
      }
    }

    const ref = randomUUID().slice(0, 8);
    this.logger.error(
      `[${ref}] ${req.method} ${req.originalUrl ?? req.url}: ${exception instanceof Error ? exception.message : String(exception)}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: `Something went wrong (ref ${ref})` });
  }
}
