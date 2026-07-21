import { fullResetAndSeed } from './helpers/db';

export const TEST_SEED_IDS = {
  accountCash: 'test-acc-cash',
  accountBank: 'test-acc-bank',
  supplier: 'test-tp-supplier',
  buyer: 'test-tp-buyer',
  employee: 'test-tp-employee',
  partner: 'test-tp-partner',
  // Cuenta SOCIO dedicada de `partner` (test-tp-partner), tal como la crearía
  // ensureSocioAccount al marcar el tercero como PARTNER. Sembrada aquí porque
  // el seed inserta third_parties por SQL crudo (bypassa el service).
  partnerAccount: 'test-acc-socio-partner',
} as const;

export const TEST_SEED_INITIAL_CASH = 100_000_000;

export default async function globalSetup() {
  await fullResetAndSeed();
}
