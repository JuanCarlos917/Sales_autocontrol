// ═══════════════════════════════════════════════════════════════
// Seed — Crea solo el usuario admin
// ═══════════════════════════════════════════════════════════════

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@autocontrol.co';
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminPin = process.env.ADMIN_PIN;

  if (!adminPassword || !adminPin) {
    console.error('❌ Define ADMIN_PASSWORD y ADMIN_PIN en el entorno antes de sembrar el usuario admin.');
    process.exit(1);
  }

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

  console.log('\n🎉 Seed completado!\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
