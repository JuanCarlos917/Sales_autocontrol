// ═══════════════════════════════════════════════════════════════
// Service — ThirdParty (Terceros: proveedores, clientes, socios)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { writeTreasuryAudit, snapshotEntity } = require('../utils/treasuryAudit');

const THIRD_PARTY_AUDIT_FIELDS = ['id', 'name', 'type', 'document', 'phone', 'email', 'notes', 'isActive', 'createdAt'];

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

    return prisma.thirdParty.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  async findById(id) {
    const thirdParty = await prisma.thirdParty.findUnique({ where: { id } });
    if (!thirdParty) throw new AppError('Tercero no encontrado', 404);
    return thirdParty;
  }

  async create(data) {
    return prisma.thirdParty.create({ data });
  }

  async update(id, data) {
    const existing = await prisma.thirdParty.findUnique({ where: { id } });
    if (!existing) throw new AppError('Tercero no encontrado', 404);

    return prisma.thirdParty.update({ where: { id }, data });
  }

  async delete(id, userId) {
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
