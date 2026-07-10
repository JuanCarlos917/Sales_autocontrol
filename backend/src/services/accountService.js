// ═══════════════════════════════════════════════════════════════
// Service — Account (Cuentas de tesorería)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { writeTreasuryAudit, snapshotEntity } = require('../utils/treasuryAudit');
const { lockRow } = require('../utils/txLocks');

const ACCOUNT_AUDIT_FIELDS = [
  'id', 'name', 'type', 'currency', 'initialBalance', 'currentBalance',
  'description', 'isActive', 'createdAt', 'updatedAt',
];

class AccountService {
  async findAll({ isActive } = {}) {
    const where = {};
    if (isActive !== undefined) where.isActive = isActive;

    const accounts = await prisma.account.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    // Saldos de TODAS las cuentas con un solo groupBy en la DB
    // (antes: 1 query por cuenta trayendo todas sus filas — 🟡 #9).
    const sums = await prisma.transaction.groupBy({
      by: ['accountId', 'type'],
      _sum: { amount: true },
      where: { accountId: { in: accounts.map((a) => a.id) } },
    });
    const balanceByAccount = new Map();
    for (const row of sums) {
      const sign = (row.type === 'INCOME' || row.type === 'TRANSFER_IN') ? 1 : -1;
      const prev = balanceByAccount.get(row.accountId) || 0;
      balanceByAccount.set(row.accountId, prev + sign * parseFloat(row._sum.amount || 0));
    }

    return accounts.map((a) => ({ ...a, currentBalance: balanceByAccount.get(a.id) || 0 }));
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

  async update(id, data, userId, { reason } = {}) {
    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) throw new AppError('Cuenta no encontrada', 404);

    // Atómico: update + audit. Si falta userId (rutas legacy) no se rompe el update,
    // pero se loguea warning para detectar callers que aún no pasan el contexto.
    return prisma.$transaction(async (tx) => {
      const updated = await tx.account.update({ where: { id }, data });
      if (userId) {
        await writeTreasuryAudit(tx, {
          entityType: 'ACCOUNT',
          entityId: id,
          userId,
          action: 'UPDATE',
          before: snapshotEntity(existing, ACCOUNT_AUDIT_FIELDS),
          after: snapshotEntity(updated, ACCOUNT_AUDIT_FIELDS),
          reason,
        });
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[accountService.update] sin userId; audit omitido para account ${id}`);
      }
      return updated;
    });
  }

  async delete(id, userId) {
    // Atómico y bajo lock (anti-TOCTOU): el check de movimientos y el delete
    // no dejan ventana; el audit DELETE deja traza del hard-delete (🟠 #6).
    return prisma.$transaction(async (tx) => {
      await lockRow(tx, 'account', id);
      const existing = await tx.account.findUnique({ where: { id } });
      if (!existing) throw new AppError('Cuenta no encontrada', 404);

      const transactionCount = await tx.transaction.count({ where: { accountId: id } });
      if (transactionCount > 0) {
        throw new AppError('No se puede eliminar una cuenta con movimientos', 400);
      }

      if (userId) {
        await writeTreasuryAudit(tx, {
          entityType: 'ACCOUNT',
          entityId: id,
          userId,
          action: 'DELETE',
          before: snapshotEntity(existing, ACCOUNT_AUDIT_FIELDS),
        });
      }

      await tx.account.delete({ where: { id } });
      return { deleted: true };
    });
  }

  async reverseAccount(id, reason, userId) {
    return prisma.$transaction(async (tx) => {
      // Validaciones DENTRO de la tx con la cuenta bloqueada (anti-TOCTOU):
      // desactivar y mover plata quedan serializados por el mismo lock.
      await lockRow(tx, 'account', id);
      const existing = await tx.account.findUnique({ where: { id } });
      if (!existing) throw new AppError('Cuenta no encontrada', 404);
      if (!existing.isActive) throw new AppError('La cuenta ya está desactivada.', 409);

      const balance = await this.calculateBalance(id, tx);
      if (Math.abs(balance) > 0.001) {
        throw new AppError('No se puede desactivar una cuenta con saldo distinto de cero.', 403);
      }
      const transactionCount = await tx.transaction.count({ where: { accountId: id } });
      if (transactionCount > 0) {
        throw new AppError('No se puede desactivar una cuenta con movimientos.', 403);
      }

      const updated = await tx.account.update({ where: { id }, data: { isActive: false } });
      await writeTreasuryAudit(tx, {
        entityType: 'ACCOUNT',
        entityId: id,
        userId,
        action: 'REVERSE',
        before: snapshotEntity(existing, ACCOUNT_AUDIT_FIELDS),
        after: snapshotEntity(updated, ACCOUNT_AUDIT_FIELDS),
        reason,
      });
      return { ...updated, currentBalance: 0 };
    });
  }

  // `client` permite calcular DENTRO de una $transaction (anti-TOCTOU): con el
  // lock de la cuenta tomado, la lectura ve el estado serializado.
  async calculateBalance(accountId, client = prisma) {
    const account = await client.account.findUnique({ where: { id: accountId } });
    if (!account) return 0;

    // Suma en la DB por tipo (antes: todas las filas al proceso y suma JS — 🟡 #9).
    // Saldo se calcula solo de transacciones (initialBalance genera su propia transacción).
    const sums = await client.transaction.groupBy({
      by: ['type'],
      _sum: { amount: true },
      where: { accountId },
    });

    let balance = 0;
    for (const row of sums) {
      const amount = parseFloat(row._sum.amount || 0);
      if (row.type === 'INCOME' || row.type === 'TRANSFER_IN') {
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
