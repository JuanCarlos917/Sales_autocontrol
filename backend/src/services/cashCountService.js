// ═══════════════════════════════════════════════════════════════
// Service — CashCount (Arqueos de caja)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');

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
      where: { accountId },
      orderBy: { date: 'desc' },
      include: {
        account: { select: { id: true, name: true, type: true } },
      },
    });
  }
}

module.exports = new CashCountService();
