import { NestFactory } from '@nestjs/core';
import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const missing = ['DATABASE_URL'].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);
  if (process.env.COOKIE_SECURE === 'false') {
    console.warn('WARNING: COOKIE_SECURE=false in production — session cookies will be sent over plain HTTP.');
  }
}

async function bootstrap() {
  assertProductionConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json: process.env.LOG_FORMAT === 'json', colors: process.env.LOG_FORMAT !== 'json' }),
  });

  // Behind nginx / a load balancer, trust the first proxy so req.ip is the real client IP
  // (used for login rate limiting and security events).
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.disable('x-powered-by');

  // Security headers (a dependency-free subset of helmet, tuned for a JSON API).
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; frame-ancestors 'none'");
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (!req.path.includes('/uploads/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // The web app talks to the API through its own origin (Next.js rewrite), so CORS is off by
  // default. Set CORS_ORIGINS only if another origin (e.g. a separate admin domain) needs access.
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length) {
    app.enableCors({ origin: origins, credentials: true });
  }

  app.useBodyParser('json', { limit: '256kb' });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, process.env.HOST ?? '0.0.0.0');
}
await bootstrap();
