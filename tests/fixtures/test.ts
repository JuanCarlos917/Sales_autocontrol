import { test as base, expect } from '@playwright/test';
import { resetStatePerTest } from '../helpers/db';

export const test = base.extend<{ _isolatedDb: void }>({
  _isolatedDb: [
    async ({}, use) => {
      await resetStatePerTest();
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { Page, Locator } from '@playwright/test';
