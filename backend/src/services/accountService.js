// ═══════════════════════════════════════════════════════════════
// Service — Account (Cuentas de tesorería)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

class AccountService {
  async findAll({ isActive } = {}) {
    const where = {};
    if (isActive !== undefined) where.isActive = isActive;

    const accounts = await prisma.account.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    // Calcular saldo actual para cada cuenta
    return Promise.all(accounts.map(async (account) => {
      const balance = await this.calculateBalance(account.id);
      return { ...account, currentBalance: balance };
    }));
  }

  async findById(id) {
    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) throw new AppError('Cuenta no encontrada', 404);

    const currentBalance = await this.calculateBalance(id);
    return { ...account, currentBalance };
  }

  async create(data, userId) {
    const { initialBalance, ...accountData } = data;
    const initialBalanceNum = parseFloat(initialBalance) || 0;

    // Crear cuenta con saldo inicial
    const account = await prisma.account.create({
      data: {
        ...accountData,
        initialBalance: initialBalanceNum,
        currentBalance: initialBalanceNum,
      },
    });

    // Si hay saldo inicial, crear transacción de ingreso
    if (initialBalanceNum > 0 && userId) {
      await prisma.transaction.create({
        data: {
          accountId: account.id,
          type: 'INCOME',
          category: 'OTHER_INCOME',
          amount: initialBalanceNum,
          description: 'Saldo inicial de cuenta',
          createdBy: userId,
        },
      });
    }

    return { ...account, currentBalance: initialBalanceNum };
  }

  async update(id, data) {
    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) throw new AppError('Cuenta no encontrada', 404);

    return prisma.account.update({ where: { id }, data });
  }

  async delete(id) {
    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) throw new AppError('Cuenta no encontrada', 404);

    // Verificar que no tenga movimientos
    const transactionCount = await prisma.transaction.count({ where: { accountId: id } });
    if (transactionCount > 0) {
      throw new AppError('No se puede eliminar una cuenta con movimientos', 400);
    }

    await prisma.account.delete({ where: { id } });
    return { deleted: true };
  }

  async calculateBalance(accountId) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return 0;

    const transactions = await prisma.transaction.findMany({
      where: { accountId },
      select: { type: true, amount: true },
    });

    // Saldo se calcula solo de transacciones (initialBalance genera su propia transacción)
    let balance = 0;
    for (const tx of transactions) {
      const amount = parseFloat(tx.amount);
      if (tx.type === 'INCOME' || tx.type === 'TRANSFER_IN') {
        balance += amount;
      } else {
        balance -= amount;
      }
    }

    return balance;
  }

  async getTotalBalance() {
    const accounts = await this.findAll({ isActive: true });
    return accounts.reduce((sum, acc) => sum + parseFloat(acc.currentBalance), 0);
  }
}

module.exports = new AccountService();
