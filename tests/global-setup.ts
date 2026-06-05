import { fullResetAndSeed } from './helpers/db';

export const TEST_SEED_IDS = {
  accountCash: 'test-acc-cash',
  accountBank: 'test-acc-bank',
  supplier: 'test-tp-supplier',
  buyer: 'test-tp-buyer',
  employee: 'test-tp-employee',
  partner: 'test-tp-partner',
} as const;

export const TEST_SEED_INITIAL_CASH = 100_000_000;

export default async function globalSetup() {
  await fullResetAndSeed();
}
