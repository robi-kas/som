import { MockPrinterTransport } from "../helpers/mock-printers.transport.js";
import { PRINTER_TRANSPORT } from "../../src/printers/printers.transport.js";
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

let app: INestApplication;
let prisma: PrismaService;
let testSchema: string | null = null;

export const getIntegrationFixture = async () => {
  if (app) return { app, prisma, testSchema: testSchema || 'public' };

  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const url = new URL(process.env.DATABASE_URL);
    testSchema = url.searchParams.get('schema') || 'public';
  } else {
    const runId = randomBytes(4).toString('hex');
    testSchema = `test_${runId}`;
    const devDb = process.env.DATABASE_URL || 'postgresql://cafe:cafe_password@localhost:5433/cafe_db?schema=public';
    const url = new URL(devDb);
    url.searchParams.set('schema', testSchema);
    process.env.DATABASE_URL = url.toString();
    console.log(`Setting up test schema: ${testSchema}`);
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'ignore' });
  }

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
  .overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })
  .overrideProvider(PRINTER_TRANSPORT)
  .useClass(MockPrinterTransport)
  .compile();

  app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  
  prisma = app.get(PrismaService);


  return { app, prisma, testSchema };
};

export const teardownIntegrationFixture = async () => {
  if (app) {
    await app.close();
    app = undefined as any;
  }
  if (testSchema && testSchema !== 'public' && !process.env.TEST_DATABASE_URL && prisma) {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE;`);
  }
};
