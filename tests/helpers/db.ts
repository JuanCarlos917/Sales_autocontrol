import { Client } from 'pg';
import { TEST_SEED_IDS, TEST_SEED_INITIAL_CASH } from '../global-setup';

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test';

const STATE_TABLES = [
  'payable_payments',
  'payables',
  'transactions',
  'transfers',
  'cash_counts',
  'documents',
  'expenses',
  'vehicles',
  'refresh_tokens',
];

const SEED_TABLES = ['third_parties', 'accounts'];

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seedAccountsAndParties(client: Client) {
  await client.query(
    `INSERT INTO accounts (id, name, type, "initialBalance", "isActive", "createdAt", "updatedAt")
     VALUES
       ($1, 'Caja Test', 'CASH', $3, true, NOW(), NOW()),
       ($2, 'Banco Test', 'BANK', 0, true, NOW(), NOW())`,
    [TEST_SEED_IDS.accountCash, TEST_SEED_IDS.accountBank, TEST_SEED_INITIAL_CASH],
  );

  await client.query(
    `INSERT INTO third_parties (id, name, type, "isActive", "createdAt", "updatedAt")
     VALUES
       ($1, 'Proveedor Test', 'SUPPLIER', true, NOW(), NOW()),
       ($2, 'Cliente Test', 'CLIENT', true, NOW(), NOW()),
       ($3, 'Empleado Test', 'EMPLOYEE', true, NOW(), NOW())`,
    [TEST_SEED_IDS.supplier, TEST_SEED_IDS.buyer, TEST_SEED_IDS.employee],
  );
}

async function seedInitialCashTransaction(client: Client) {
  await client.query(
    `INSERT INTO transactions (id, "accountId", type, category, amount, description, "createdBy", date, "createdAt", "updatedAt")
     SELECT 'test-tx-seed-cash', $1, 'INCOME', 'OTHER_INCOME', $2, 'Saldo inicial de cuenta', u.id, NOW(), NOW(), NOW()
     FROM users u WHERE u.email = 'admin@autocontrol.co' LIMIT 1`,
    [TEST_SEED_IDS.accountCash, TEST_SEED_INITIAL_CASH],
  );
}

export async function fullResetAndSeed() {
  await withClient(async (client) => {
    const all = [...STATE_TABLES, ...SEED_TABLES].map((t) => `"${t}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${all} RESTART IDENTITY CASCADE`);
    await seedAccountsAndParties(client);
    await seedInitialCashTransaction(client);
  });
}

export async function resetStatePerTest() {
  await withClient(async (client) => {
    const list = STATE_TABLES.map((t) => `"${t}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    await seedInitialCashTransaction(client);
  });
}

/**
 * Forzar el stage de un vehiculo bypaseando validaciones de negocio.
 * Solo para tests que necesitan colocar un vehiculo en VENDIDO directamente.
 */
export async function forceVehicleStage(vehicleId: string, stage: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`UPDATE vehicles SET stage = $1, "updatedAt" = NOW() WHERE id = $2`, [stage, vehicleId]);
  });
}

/**
 * Cambia el rol de un usuario directamente en DB.
 * Para tests que necesitan ejercer la policy de edición por rol (ADMIN vs SUPERVISOR).
 * El middleware de auth re-lee el rol en cada request, así que el cambio surte efecto
 * de inmediato sin re-loguear. Restaurar a 'ADMIN' en cleanup.
 */
export async function setUserRole(email: string, role: 'ADMIN' | 'SUPERVISOR' | 'VIEWER'): Promise<void> {
  await withClient(async (client) => {
    await client.query(`UPDATE users SET role = $1::"Role", "updatedAt" = NOW() WHERE email = $2`, [role, email]);
  });
}
