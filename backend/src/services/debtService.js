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
