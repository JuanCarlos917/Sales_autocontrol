// ═══════════════════════════════════════════════════════════════
// Service — Transaction (Movimientos de tesorería)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');

const TRANSACTION_INCLUDE = {
  account: { select: { id: true, name: true, type: true } },
  thirdParty: { select: { id: true, name: true, type: true } },
  vehicle: { select: { id: true, plate: true, brand: true, model: true } },
};

class TransactionService {
  async findAll({ accountId, vehicleId, thirdPartyId, type, category, startDate, endDate, limit = 100, offset = 0 } = {}) {
    const where = {};
    if (accountId) where.accountId = accountId;
    if (vehicleId) where.vehicleId = vehicleId;
    if (thirdPartyId) where.thirdPartyId = thirdPartyId;
    if (type) where.type = type;
    if (category) where.category = category;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: TRANSACTION_INCLUDE,
        // Prioridad por fecha del movimiento (hoy arriba) y, dentro de la misma fecha,
        // por hora real de registro: quedan en el orden en que se hicieron, sin agrupar
        // egresos con egresos.
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.transaction.count({ where }),
    ]);

    return { transactions, total, limit, offset };
  }

  async findById(id) {
    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: TRANSACTION_INCLUDE,
    });
    if (!transaction) throw new AppError('Movimiento no encontrado', 404);
    return transaction;
  }

  async findByVehicle(vehicleId) {
    return prisma.transaction.findMany({
      where: { vehicleId },
      include: TRANSACTION_INCLUDE,
      orderBy: { date: 'desc' },
    });
  }

  async createIncome(data, userId) {
    return this.createTransaction({ ...data, type: 'INCOME' }, userId);
  }

  async createExpense(data, userId) {
    // Validar saldo suficiente
    const currentBalance = await accountService.calculateBalance(data.accountId);
    if (currentBalance < data.amount) {
      throw new AppError('Saldo insuficiente en la cuenta', 400);
    }

    return this.createTransaction({ ...data, type: 'EXPENSE' }, userId);
  }

  async createTransaction(data, userId) {
    const { accountId, type, category, amount, description, reference, date, vehicleId, thirdPartyId, expenseId } = data;

    // Verificar que la cuenta existe
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError('Cuenta no encontrada', 404);

    return prisma.transaction.create({
      data: {
        accountId,
        type,
        category,
        amount,
        description,
        reference,
        date: date ? new Date(date) : new Date(),
        vehicleId,
        thirdPartyId,
        expenseId,
        createdBy: userId,
      },
      include: TRANSACTION_INCLUDE,
    });
  }

  async update(id, data, userId) {
    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) throw new AppError('Movimiento no encontrado', 404);

    // Transactions ligadas a un gasto: se editan a través del gasto
    if (existing.expenseId) {
      throw new AppError('Este movimiento proviene de un gasto. Editá el gasto en /expenses.', 403);
    }

    // No permitir cambiar tipo o cuenta después de creado
    const allowedFields = ['description', 'reference', 'date', 'thirdPartyId'];
    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = field === 'date' ? new Date(data[field]) : data[field];
      }
    }

    return prisma.transaction.update({
      where: { id },
      data: updateData,
      include: TRANSACTION_INCLUDE,
    });
  }

  async delete(id) {
    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) throw new AppError('Movimiento no encontrado', 404);

    // Transactions ligadas a un gasto: se borran a través del gasto (soft delete + reverso)
    if (existing.expenseId) {
      throw new AppError('Este movimiento proviene de un gasto. Eliminá el gasto en /expenses.', 403);
    }

    // No permitir eliminar si está vinculado a un vehículo vendido
    if (existing.vehicleId) {
      const vehicle = await prisma.vehicle.findUnique({ where: { id: existing.vehicleId } });
      if (vehicle && vehicle.stage === 'VENDIDO') {
        throw new AppError('No se puede eliminar un movimiento de un vehículo vendido', 400);
      }
    }

    // No permitir eliminar movimientos de transferencia directamente
    if (existing.transferId) {
      throw new AppError('Para eliminar una transferencia, use el endpoint de transferencias', 400);
    }

    await prisma.transaction.delete({ where: { id } });
    return { deleted: true };
  }

  async getSummary({ startDate, endDate, accountId } = {}) {
    const where = {};
    if (accountId) where.accountId = accountId;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const transactions = await prisma.transaction.findMany({
      where,
      select: { type: true, category: true, amount: true },
    });

    let totalIncome = 0;
    let totalExpense = 0;
    const byCategory = {};

    for (const tx of transactions) {
      const amount = parseFloat(tx.amount);
      if (tx.type === 'INCOME' || tx.type === 'TRANSFER_IN') {
        totalIncome += amount;
      } else {
        totalExpense += amount;
      }

      // Solo contar categorías principales (no transferencias)
      if (tx.category !== 'TRANSFER') {
        byCategory[tx.category] = (byCategory[tx.category] || 0) + amount;
      }
    }

    return {
      totalIncome,
      totalExpense,
      netFlow: totalIncome - totalExpense,
      byCategory,
    };
  }
}

module.exports = new TransactionService();
