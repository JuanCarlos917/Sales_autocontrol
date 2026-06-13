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

  async addPayment(debtId, { accountId, amount, date, notes }, userId) {
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
