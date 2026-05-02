import { Client } from 'pg';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test';

const TABLES_TO_TRUNCATE = [
  'payable_payments',
  'payables',
  'transactions',
  'transfers',
  'cash_counts',
  'documents',
  'expenses',
  'vehicles',
  'third_parties',
  'accounts',
];

export const TEST_SEED_IDS = {
  accountCash: 'test-acc-cash',
  supplier: 'test-tp-supplier',
  buyer: 'test-tp-buyer',
} as const;

export default async function globalSetup() {
  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  try {
    const list = TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

    await client.query(
      `INSERT INTO accounts (id, name, type, "initialBalance", "isActive", "createdAt", "updatedAt")
       VALUES ($1, 'Caja Test', 'CASH', 1000000, true, NOW(), NOW())`,
      [TEST_SEED_IDS.accountCash],
    );

    await client.query(
      `INSERT INTO third_parties (id, name, type, "isActive", "createdAt", "updatedAt")
       VALUES
         ($1, 'Proveedor Test', 'SUPPLIER', true, NOW(), NOW()),
         ($2, 'Cliente Test', 'CLIENT', true, NOW(), NOW())`,
      [TEST_SEED_IDS.supplier, TEST_SEED_IDS.buyer],
    );
  } finally {
    await client.end();
  }
}
