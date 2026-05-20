// ═══════════════════════════════════════════════════════════════
// Service — Transfer (Transferencias entre cuentas)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');

class TransferService {
  async findAll({ startDate, endDate, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [transfers, total] = await Promise.all([
      prisma.transfer.findMany({
        where,
        include: {
          fromAccount: { select: { id: true, name: true } },
          toAccount: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.transfer.count({ where }),
    ]);

    return { transfers, total, limit, offset };
  }

  async findById(id) {
    const transfer = await prisma.transfer.findUnique({
      where: { id },
      include: {
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
        transactions: true,
      },
    });
    if (!transfer) throw new AppError('Transferencia no encontrada', 404);
    return transfer;
  }

  async create(data, userId) {
    const { fromAccountId, toAccountId, amount, description, date } = data;

    if (fromAccountId === toAccountId) {
      throw new AppError('Las cuentas de origen y destino deben ser diferentes', 400);
    }

    // Verificar que ambas cuentas existen
    const [fromAccount, toAccount] = await Promise.all([
      prisma.account.findUnique({ where: { id: fromAccountId } }),
      prisma.account.findUnique({ where: { id: toAccountId } }),
    ]);

    if (!fromAccount) throw new AppError('Cuenta de origen no encontrada', 404);
    if (!toAccount) throw new AppError('Cuenta de destino no encontrada', 404);

    // Verificar saldo suficiente
    const currentBalance = await accountService.calculateBalance(fromAccountId);
    if (currentBalance < amount) {
      throw new AppError('Saldo insuficiente en la cuenta de origen', 400);
    }

    // Crear transferencia y movimientos en una transacción atómica
    const result = await prisma.$transaction(async (tx) => {
      // Crear el registro de transferencia
      const transfer = await tx.transfer.create({
        data: {
          fromAccountId,
          toAccountId,
          amount,
          description,
          date: new Date(), // fecha de contabilización = instante de registro
          createdBy: userId,
        },
      });

      // Crear movimiento de salida
      await tx.transaction.create({
        data: {
          accountId: fromAccountId,
          type: 'TRANSFER_OUT',
          category: 'TRANSFER',
          amount,
          description: description || `Transferencia a ${toAccount.name}`,
          date: new Date(), // fecha de contabilización = instante de registro
          transferId: transfer.id,
          createdBy: userId,
        },
      });

      // Crear movimiento de entrada
      await tx.transaction.create({
        data: {
          accountId: toAccountId,
          type: 'TRANSFER_IN',
          category: 'TRANSFER',
          amount,
          description: description || `Transferencia desde ${fromAccount.name}`,
          date: new Date(), // fecha de contabilización = instante de registro
          transferId: transfer.id,
          createdBy: userId,
        },
      });

      return transfer;
    });

    return this.findById(result.id);
  }

  async delete(id) {
    const transfer = await prisma.transfer.findUnique({
      where: { id },
      include: { transactions: true },
    });

    if (!transfer) throw new AppError('Transferencia no encontrada', 404);

    // Eliminar en transacción atómica
    await prisma.$transaction(async (tx) => {
      // Eliminar movimientos asociados
      await tx.transaction.deleteMany({ where: { transferId: id } });
      // Eliminar transferencia
      await tx.transfer.delete({ where: { id } });
    });

    return { deleted: true };
  }
}

module.exports = new TransferService();
