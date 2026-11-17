import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';
import { expect, it } from 'vitest';

// The console's types are generated from api/openapi.yaml; a change to the
// contract that was not regenerated fails here (`pnpm api:types`).
it('api.gen.ts is generated from the current api/openapi.yaml', async () => {
  const spec = new URL('../../../../api/openapi.yaml', import.meta.url);
  const fresh = astToString(await openapiTS(spec));
  const committed = readFileSync(fileURLToPath(new URL('../lib/api.gen.ts', import.meta.url)), 'utf8');
  expect(committed.slice(committed.indexOf('export'))).toBe(fresh.slice(fresh.indexOf('export')));
});
