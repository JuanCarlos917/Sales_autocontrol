// ═══════════════════════════════════════════════════════════════
// Service — CashCount (Arqueos de caja)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');
const { writeTreasuryAudit } = require('../utils/treasuryAudit');

class CashCountService {
  async findAll({ accountId, startDate, endDate, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (accountId) where.accountId = accountId;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [cashCounts, total] = await Promise.all([
      prisma.cashCount.findMany({
        where,
        include: {
          account: { select: { id: true, name: true, type: true } },
        },
        orderBy: { date: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.cashCount.count({ where }),
    ]);

    return { cashCounts, total, limit, offset };
  }

  async findById(id) {
    const cashCount = await prisma.cashCount.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true, type: true } },
      },
    });
    if (!cashCount) throw new AppError('Arqueo no encontrado', 404);
    return cashCount;
  }

  async create(data, userId) {
    const { accountId, countedBalance, notes, date } = data;

    // Verificar que la cuenta existe
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError('Cuenta no encontrada', 404);

    // Calcular saldo esperado
    const expectedBalance = await accountService.calculateBalance(accountId);
    const difference = parseFloat(countedBalance) - expectedBalance;

    return prisma.cashCount.create({
      data: {
        accountId,
        expectedBalance,
        countedBalance,
        difference,
        notes,
        date: date ? new Date(date) : new Date(),
        createdBy: userId,
      },
      include: {
        account: { select: { id: true, name: true, type: true } },
      },
    });
  }

  async getLastByAccount(accountId) {
    return prisma.cashCount.findFirst({
      where: { accountId, voidedAt: null },
      orderBy: { date: 'desc' },
      include: {
        account: { select: { id: true, name: true, type: true } },
      },
    });
  }

  async reverse(id, reason, userId) {
    const cashCount = await prisma.cashCount.findUnique({ where: { id } });
    if (!cashCount) throw new AppError('Arqueo no encontrado', 404);
    if (cashCount.voidedAt) throw new AppError('Este arqueo ya fue anulado.', 409);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.cashCount.update({
        where: { id },
        data: { voidedAt: new Date(), voidedBy: userId, voidReason: reason },
        include: { account: { select: { id: true, name: true, type: true } } },
      });
      await writeTreasuryAudit(tx, {
        entityType: 'CASH_COUNT',
        entityId: id,
        userId,
        action: 'REVERSE',
        before: { voidedAt: null, difference: cashCount.difference.toString() },
        after: { voidedAt: updated.voidedAt.toISOString(), voidReason: reason },
        reason,
      });
      return updated;
    });
  }
}

module.exports = new CashCountService();
