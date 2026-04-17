// ═══════════════════════════════════════════════════════════════
// Seed — Crea usuario admin y configuración inicial
// ═══════════════════════════════════════════════════════════════

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@autocontrol.co';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
  const adminPin = process.env.ADMIN_PIN || '1234';

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existing) {
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    const hashedPin = await bcrypt.hash(adminPin, 10);

    await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        pin: hashedPin,
        name: 'Administrador',
        role: 'ADMIN',
      },
    });
    console.log(`  ✅ Admin creado: ${adminEmail}`);
    console.log(`  🔑 Password: ${adminPassword}`);
    console.log(`  📌 PIN: ${adminPin}`);
  } else {
    console.log(`  ℹ️  Admin ya existe: ${adminEmail}`);
  }

  // Default settings
  const defaults = {
    fixedMonthly: '800000',
    alertDays: '15',
  };

  for (const [key, value] of Object.entries(defaults)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }
  console.log('  ✅ Configuración inicial creada');

  // Treasury accounts
  const defaultAccounts = [
    { name: 'Caja Principal', type: 'CASH', initialBalance: 0 },
    { name: 'Cuenta Bancolombia', type: 'SAVINGS', bank: 'Bancolombia', initialBalance: 0 },
  ];

  for (const acc of defaultAccounts) {
    const existingAccount = await prisma.account.findFirst({ where: { name: acc.name } });
    if (!existingAccount) {
      await prisma.account.create({ data: acc });
    }
  }
  console.log('  ✅ Cuentas de tesorería creadas');

  console.log('\n🎉 Seed completado!\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
