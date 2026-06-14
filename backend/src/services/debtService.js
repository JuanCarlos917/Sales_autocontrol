// ═══════════════════════════════════════════════════════════════
// Service — Debts (créditos/financiaciones del negocio, lado pasivo)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');
const { writeTreasuryAudit, snapshotEntity } = require('../utils/treasuryAudit');

const DEBT_INCLUDE = {
  installments: { orderBy: { sequence: 'asc' } },
  payments: {
    orderBy: { date: 'desc' },
    include: { account: { select: { id: true, name: true } } },
  },
};

const DEBT_SNAPSHOT_FIELDS = ['name', 'lender', 'totalAmount', 'paidAmount', 'status'];

// Categorías de egreso que NO representan un gasto real reconciliable a una deuda
// (correcciones de ledger, desembolsos de préstamo, o ya enlazados a un crédito).
const NON_RECONCILABLE_CATEGORIES = ['EXPENSE_REVERSAL', 'EXPENSE_ADJUSTMENT', 'DEBT_PAYMENT', 'LOAN_DISBURSEMENT'];

function recomputeDebtStatus(total, paid) {
  const t = parseFloat(total);
  const q = parseFloat(paid);
  if (q <= 0) return 'PENDING';
  if (q >= t) return 'PAID';
  return 'PARTIAL';
}

function recomputeInstallmentStatus(planned, paid) {
  const p = parseFloat(planned);
  const q = parseFloat(paid);
  if (q <= 0) return 'PENDING';
  if (q >= p) return 'PAID';
  return 'PARTIAL';
}

function annotateOverdue(debt) {
  if (debt.status === 'PAID' || debt.status === 'CANCELLED') {
    return { ...debt, isOverdue: false };
  }
  const now = new Date();
  const isOverdue = debt.installments.some(
    (i) => i.status !== 'PAID' && new Date(i.dueDate) < now,
  );
  return { ...debt, isOverdue };
}

class DebtService {
  async create({ name, lender, assetDescription, startDate, notes, installments }, userId) {
    const sequences = installments.map((i) => i.sequence).sort((a, b) => a - b);
    for (let i = 0; i < sequences.length; i++) {
      if (sequences[i] !== i + 1) {
        throw new AppError('Las secuencias de cuotas deben ser 1..N sin huecos ni duplicados', 400);
      }
    }

    const totalAmount = installments.reduce((s, i) => s + parseFloat(i.plannedAmount), 0);

    const result = await prisma.$transaction(async (tx) => {
      const debt = await tx.debt.create({
        data: {
          name,
          lender: lender || null,
          assetDescription: assetDescription || null,
          totalAmount,
          startDate: startDate ? new Date(startDate) : new Date(),
          notes: notes || null,
          createdBy: userId,
          installments: {
            create: installments.map((i) => ({
              sequence: i.sequence,
              dueDate: new Date(i.dueDate),
              plannedAmount: parseFloat(i.plannedAmount),
            })),
          },
        },
        include: DEBT_INCLUDE,
      });

      await writeTreasuryAudit(tx, {
        entityType: 'DEBT',
        entityId: debt.id,
        userId,
        action: 'CREATE',
        after: snapshotEntity(debt, DEBT_SNAPSHOT_FIELDS),
      });

      return debt;
    });

    return annotateOverdue(result);
  }

  async list({ status } = {}) {
    const where = {};
    if (status) where.status = status;
    const debts = await prisma.debt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: DEBT_INCLUDE,
    });
    return debts.map(annotateOverdue);
  }

  async findById(id) {
    const debt = await prisma.debt.findUnique({ where: { id }, include: DEBT_INCLUDE });
    if (!debt) throw new AppError('Crédito no encontrado', 404);
    return annotateOverdue(debt);
  }

  async addPayment(debtId, { accountId, amount, notes }, userId) {
    const pay = parseFloat(amount);
    if (pay <= 0) throw new AppError('El pago debe ser mayor a 0', 400);

    const debt = await prisma.debt.findUnique({
      where: { id: debtId },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    });
    if (!debt) throw new AppError('Crédito no encontrado', 404);
    if (debt.status === 'CANCELLED') throw new AppError('Crédito cancelado', 400);
    if (debt.status === 'PAID') throw new AppError('Crédito ya está totalmente pagado', 400);

    const remaining = parseFloat(debt.totalAmount) - parseFloat(debt.paidAmount);
    if (pay > remaining + 0.001) {
      throw new AppError(`El monto (${pay}) excede el saldo pendiente (${remaining})`, 400);
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || !account.isActive) throw new AppError('Cuenta origen no encontrada o inactiva', 404);

    const balance = await accountService.calculateBalance(accountId);
    if (balance < pay) {
      throw new AppError(`Saldo insuficiente en la cuenta origen (saldo: ${balance}, requerido: ${pay})`, 400);
    }

    // Imputación FIFO a cuotas pendientes
    let rest = pay;
    const installmentUpdates = [];
    for (const inst of debt.installments) {
      if (rest <= 0) break;
      const owed = parseFloat(inst.plannedAmount) - parseFloat(inst.paidAmount);
      if (owed <= 0) continue;
      const apply = Math.min(owed, rest);
      const newPaid = parseFloat(inst.paidAmount) + apply;
      installmentUpdates.push({ id: inst.id, newPaid, newStatus: recomputeInstallmentStatus(inst.plannedAmount, newPaid) });
      rest -= apply;
    }

    const newPaidAmount = parseFloat(debt.paidAmount) + pay;
    const newStatus = recomputeDebtStatus(debt.totalAmount, newPaidAmount);

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.debtPayment.create({
        data: {
          debtId,
          accountId,
          amount: pay,
          date: new Date(), // fecha de contabilización = instante de registro
          notes: notes || null,
          createdBy: userId,
        },
      });

      await tx.transaction.create({
        data: {
          accountId,
          type: 'EXPENSE',
          category: 'DEBT_PAYMENT',
          amount: pay,
          description: `Pago crédito: ${debt.name}`,
          date: new Date(),
          debtId,
          debtPaymentId: payment.id,
          createdBy: userId,
        },
      });

      for (const u of installmentUpdates) {
        await tx.debtInstallment.update({
          where: { id: u.id },
          data: { paidAmount: u.newPaid, status: u.newStatus },
        });
      }

      const updatedDebt = await tx.debt.update({
        where: { id: debtId },
        data: { paidAmount: newPaidAmount, status: newStatus },
        include: DEBT_INCLUDE,
      });

      await writeTreasuryAudit(tx, {
        entityType: 'DEBT', entityId: debtId, userId, action: 'PAYMENT',
        before: { paidAmount: debt.paidAmount.toString(), status: debt.status },
        after: { paidAmount: String(newPaidAmount), status: newStatus, debtPaymentId: payment.id },
      });

      return updatedDebt;
    });

    return annotateOverdue(result);
  }

  // Egresos históricos candidatos a enlazar: transacciones EXPENSE
  // que no estén ya enlazadas a una deuda. Filtro opcional por texto.
  async reconcileCandidates({ search } = {}) {
    const where = { type: 'EXPENSE', debtId: null, category: { notIn: NON_RECONCILABLE_CATEGORIES } };
    if (search) where.description = { contains: search, mode: 'insensitive' };
    return prisma.transaction.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 200,
      select: {
        id: true, date: true, amount: true, description: true, category: true,
        accountId: true, vehicleId: true, expenseId: true,
        account: { select: { id: true, name: true } },
      },
    });
  }

  // Enlaza egresos existentes a la deuda SIN crear movimiento de caja nuevo
  // ni alterar montos. Reclasifica la transacción a DEBT_PAYMENT, la desliga
  // del vehículo, y soft-deletea el Expense de origen (sin reversa de caja).
  async reconcile(debtId, { transactionIds }, userId) {
    const debt = await prisma.debt.findUnique({
      where: { id: debtId },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    });
    if (!debt) throw new AppError('Crédito no encontrado', 404);
    if (debt.status === 'CANCELLED') throw new AppError('Crédito cancelado', 400);

    const txs = await prisma.transaction.findMany({ where: { id: { in: transactionIds } } });
    if (txs.length !== transactionIds.length) {
      throw new AppError('Alguna transacción no existe', 404);
    }
    for (const t of txs) {
      if (t.type !== 'EXPENSE') throw new AppError(`La transacción ${t.id} no es un egreso`, 400);
      if (t.debtId) throw new AppError(`La transacción ${t.id} ya está enlazada a una deuda`, 400);
      if (NON_RECONCILABLE_CATEGORIES.includes(t.category)) {
        throw new AppError(`La transacción ${t.id} (${t.category}) no es un egreso reconciliable`, 400);
      }
    }

    const sumLink = txs.reduce((s, t) => s + parseFloat(t.amount), 0);
    const remaining = parseFloat(debt.totalAmount) - parseFloat(debt.paidAmount);
    if (sumLink > remaining + 0.001) {
      throw new AppError(`Lo reconciliado (${sumLink}) excede el saldo pendiente (${remaining})`, 400);
    }

    // Estado mutable en memoria para imputación FIFO acumulada
    const instState = debt.installments.map((i) => ({
      id: i.id, planned: parseFloat(i.plannedAmount), paid: parseFloat(i.paidAmount),
    }));
    let runningPaid = parseFloat(debt.paidAmount);

    const result = await prisma.$transaction(async (tx) => {
      for (const t of txs) {
        const amt = parseFloat(t.amount);

        const payment = await tx.debtPayment.create({
          data: {
            debtId, accountId: t.accountId, amount: amt,
            date: t.date, notes: 'Reconciliación de egreso histórico', createdBy: userId,
          },
        });

        const before = { category: t.category, vehicleId: t.vehicleId, expenseId: t.expenseId, debtId: t.debtId };
        await tx.transaction.update({
          where: { id: t.id },
          data: {
            category: 'DEBT_PAYMENT',
            vehicleId: null,
            expenseId: null,
            debtId,
            debtPaymentId: payment.id,
          },
        });
        await writeTreasuryAudit(tx, {
          entityType: 'TRANSACTION', entityId: t.id, userId, action: 'UPDATE',
          before,
          after: { category: 'DEBT_PAYMENT', vehicleId: null, expenseId: null, debtId, debtPaymentId: payment.id },
          reason: `Reconciliación a crédito ${debtId}`,
        });

        // Soft-delete del Expense de origen (sin reversa de caja).
        // Solo si no estaba ya borrado, para no pisar la metadata de borrado original.
        if (t.expenseId) {
          const exp = await tx.expense.findUnique({ where: { id: t.expenseId }, select: { deletedAt: true } });
          if (exp && !exp.deletedAt) {
            await tx.expense.update({
              where: { id: t.expenseId },
              data: { deletedAt: new Date(), deletedBy: userId },
            });
          }
        }

        // Imputación FIFO acumulada
        let rest = amt;
        for (const s of instState) {
          if (rest <= 0) break;
          const owed = s.planned - s.paid;
          if (owed <= 0) continue;
          const apply = Math.min(owed, rest);
          s.paid += apply;
          rest -= apply;
          await tx.debtInstallment.update({
            where: { id: s.id },
            data: { paidAmount: s.paid, status: recomputeInstallmentStatus(s.planned, s.paid) },
          });
        }
        runningPaid += amt;

        await writeTreasuryAudit(tx, {
          entityType: 'DEBT', entityId: debtId, userId, action: 'PAYMENT',
          after: { reconciledTransactionId: t.id, amount: String(amt), debtPaymentId: payment.id },
        });
      }

      const updatedDebt = await tx.debt.update({
        where: { id: debtId },
        data: { paidAmount: runningPaid, status: recomputeDebtStatus(debt.totalAmount, runningPaid) },
        include: DEBT_INCLUDE,
      });
      return updatedDebt;
    });

    return annotateOverdue(result);
  }

  async cancel(debtId, userId) {
    const debt = await prisma.debt.findUnique({ where: { id: debtId } });
    if (!debt) throw new AppError('Crédito no encontrado', 404);
    if (debt.status !== 'PENDING') {
      throw new AppError('Solo se pueden cancelar créditos sin pagos (status PENDING)', 400);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const d = await tx.debt.update({
        where: { id: debtId },
        data: { status: 'CANCELLED' },
        include: DEBT_INCLUDE,
      });
      await writeTreasuryAudit(tx, {
        entityType: 'DEBT', entityId: debtId, userId, action: 'CANCEL',
        before: snapshotEntity(debt, DEBT_SNAPSHOT_FIELDS),
      });
      return d;
    });
    return annotateOverdue(updated);
  }
}

module.exports = new DebtService();
module.exports.recomputeDebtStatus = recomputeDebtStatus;
module.exports.recomputeInstallmentStatus = recomputeInstallmentStatus;
module.exports.annotateOverdue = annotateOverdue;
module.exports.DEBT_INCLUDE = DEBT_INCLUDE;
