// ═══════════════════════════════════════════════════════════════
// Service — ThirdParty (Terceros: proveedores, clientes, socios)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { writeTreasuryAudit, snapshotEntity } = require('../utils/treasuryAudit');

const THIRD_PARTY_AUDIT_FIELDS = ['id', 'name', 'type', 'document', 'phone', 'email', 'notes', 'isActive', 'createdAt'];

// Terceros centinela del sistema (creados por migración, referenciados por código).
// owner-self = "Dueño / Yo", destino del resto del reparto de comisiones. Borrarlo
// rompe toda venta que reparte comisión (FK en la CxP COMMISSION → 500).
const SYSTEM_THIRD_PARTY_IDS = new Set(['owner-self']);

function assertThirdPartyDeletable(id) {
  if (SYSTEM_THIRD_PARTY_IDS.has(id)) {
    throw new AppError('No se puede eliminar el tercero del sistema "Dueño / Yo"', 400);
  }
}

// Crea la cuenta SOCIO del tercero si aún no existe (idempotente). No aplica
// si el tercero no es PARTNER. Recibe prisma o una tx para poder encadenarse
// en operaciones transaccionales futuras.
async function ensureSocioAccount(prismaOrTx, thirdParty) {
  if (!thirdParty || thirdParty.type !== 'PARTNER') return null;
  const existing = await prismaOrTx.account.findFirst({
    where: { type: 'SOCIO', thirdPartyId: thirdParty.id },
  });
  if (existing) return existing;
  return prismaOrTx.account.create({
    data: {
      name: `Cuenta Socio — ${thirdParty.name}`,
      type: 'SOCIO',
      initialBalance: 0,
      isActive: true,
      thirdPartyId: thirdParty.id,
    },
  });
}

// Lee los thirdPartyId del equipo de inversionistas (investor_team) de forma
// defensiva, sin exigir las demás keys de comisiones (a diferencia de
// loadCommissionConfig). Devuelve un Set; investor_team corrupto/ausente → vacío.
async function getInvestorThirdPartyIds() {
  const ids = new Set();
  const row = await prisma.setting.findUnique({ where: { key: 'investor_team' } });
  if (row?.value) {
    try {
      const team = JSON.parse(row.value);
      if (Array.isArray(team)) team.forEach((t) => t?.thirdPartyId && ids.add(t.thirdPartyId));
    } catch { /* investor_team corrupto → sin miembros */ }
  }
  return ids;
}

class ThirdPartyService {
  async findAll({ type, isActive, search } = {}) {
    const where = {};
    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { document: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [list, investorIds] = await Promise.all([
      prisma.thirdParty.findMany({ where, orderBy: { name: 'asc' } }),
      getInvestorThirdPartyIds(),
    ]);
    // isInvestor: owner-self o miembro del investor_team. Permite a la UI (p. ej.
    // validación del socio en la compra) saber quién es inversionista sin depender
    // del endpoint ADMIN-only de commission-config.
    return list.map((tp) => ({ ...tp, isInvestor: tp.id === 'owner-self' || investorIds.has(tp.id) }));
  }

  async findById(id) {
    const thirdParty = await prisma.thirdParty.findUnique({ where: { id } });
    if (!thirdParty) throw new AppError('Tercero no encontrado', 404);
    return thirdParty;
  }

  async create(data) {
    const created = await prisma.thirdParty.create({ data });
    if (created.type === 'PARTNER') await ensureSocioAccount(prisma, created);
    return created;
  }

  async update(id, data) {
    const existing = await prisma.thirdParty.findUnique({ where: { id } });
    if (!existing) throw new AppError('Tercero no encontrado', 404);

    const updated = await prisma.thirdParty.update({ where: { id }, data });
    if (updated.type === 'PARTNER') await ensureSocioAccount(prisma, updated);
    return updated;
  }

  async delete(id, userId) {
    assertThirdPartyDeletable(id); // guard de centinelas antes de tocar la DB
    const existing = await prisma.thirdParty.findUnique({ where: { id } });
    if (!existing) throw new AppError('Tercero no encontrado', 404);

    // Check + delete atómicos (sin ventana TOCTOU), con audit DELETE
    // (entidad THIRD_PARTY, migración 20260710). El gate ADMIN vive en la ruta.
    return prisma.$transaction(async (tx) => {
      const transactionCount = await tx.transaction.count({ where: { thirdPartyId: id } });
      if (transactionCount > 0) {
        throw new AppError('No se puede eliminar un tercero con movimientos asociados', 400);
      }
      if (userId) {
        await writeTreasuryAudit(tx, {
          entityType: 'THIRD_PARTY',
          entityId: id,
          userId,
          action: 'DELETE',
          before: snapshotEntity(existing, THIRD_PARTY_AUDIT_FIELDS),
        });
      }
      await tx.thirdParty.delete({ where: { id } });
      return { deleted: true };
    });
  }

  async getStatement(id, { startDate, endDate } = {}) {
    const thirdParty = await this.findById(id);

    const where = { thirdPartyId: id };
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: { account: { select: { name: true } } },
      orderBy: { date: 'desc' },
    });

    // Calcular totales
    let totalIncome = 0;
    let totalExpense = 0;
    for (const tx of transactions) {
      const amount = parseFloat(tx.amount);
      if (tx.type === 'INCOME') totalIncome += amount;
      else if (tx.type === 'EXPENSE') totalExpense += amount;
    }

    return {
      thirdParty,
      transactions,
      summary: {
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense,
      },
    };
  }
}

module.exports = new ThirdPartyService();
module.exports.assertThirdPartyDeletable = assertThirdPartyDeletable;
module.exports.SYSTEM_THIRD_PARTY_IDS = SYSTEM_THIRD_PARTY_IDS;
module.exports.ensureSocioAccount = ensureSocioAccount;
