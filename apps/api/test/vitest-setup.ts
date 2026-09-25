import { teardownIntegrationFixture } from './integration/fixture.js';
import { afterAll } from 'vitest';

afterAll(async () => {
  await teardownIntegrationFixture();
});
