// ═══════════════════════════════════════════════════════════════
// Service — Debts (créditos/financiaciones del negocio, lado pasivo)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');
const { writeTreasuryAudit, snapshotEntity } = require('../utils/treasuryAudit');
const { applyReversalInTx, ALREADY_REVERSED } = require('./reversalEngine');
const { recomputeDebtFromPayments } = require('../utils/debtReversal');
const { lockRow } = require('../utils/txLocks');

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
// Los compensatorios de reversos (MANUAL/LOAN/DEBT_REVERSAL) tampoco: son
// correcciones, no plata que haya pagado nada.
const NON_RECONCILABLE_CATEGORIES = [
  'EXPENSE_REVERSAL', 'EXPENSE_ADJUSTMENT', 'DEBT_PAYMENT', 'LOAN_DISBURSEMENT',
  'MANUAL_REVERSAL', 'LOAN_REVERSAL', 'DEBT_REVERSAL',
];

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

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || !account.isActive) throw new AppError('Cuenta origen no encontrada o inactiva', 404);

    const result = await prisma.$transaction(async (tx) => {
      // Lectura autoritativa DENTRO de la tx (anti-TOCTOU). Orden de locks:
      // entidad padre primero, cuenta después (ver utils/txLocks).
      await lockRow(tx, 'debt', debtId);
      await lockRow(tx, 'account', accountId);

      const debt = await tx.debt.findUnique({
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

      const balance = await accountService.calculateBalance(accountId, tx);
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
    const where = {
      type: 'EXPENSE',
      debtId: null,
      category: { notIn: NON_RECONCILABLE_CATEGORIES },
      // Guardas anti-"dinero fantasma": ni compensatorios de un reverso,
      // ni egresos cuya plata ya volvió a caja por haber sido reversados.
      reversesTransactionId: null,
      reversedBy: { none: {} },
    };
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
    const result = await prisma.$transaction(async (tx) => {
      // Lectura autoritativa DENTRO de la tx con el crédito bloqueado
      // (anti-TOCTOU): agregados y validaciones sobre el estado serializado.
      await lockRow(tx, 'debt', debtId);
      const debt = await tx.debt.findUnique({
        where: { id: debtId },
        include: { installments: { orderBy: { sequence: 'asc' } } },
      });
      if (!debt) throw new AppError('Crédito no encontrado', 404);
      if (debt.status === 'CANCELLED') throw new AppError('Crédito cancelado', 400);

      const txs = await tx.transaction.findMany({
        where: { id: { in: transactionIds } },
        include: { reversedBy: { select: { id: true }, take: 1 } },
      });
      if (txs.length !== transactionIds.length) {
        throw new AppError('Alguna transacción no existe', 404);
      }
      for (const t of txs) {
        if (t.type !== 'EXPENSE') throw new AppError(`La transacción ${t.id} no es un egreso`, 400);
        if (t.debtId) throw new AppError(`La transacción ${t.id} ya está enlazada a una deuda`, 400);
        if (NON_RECONCILABLE_CATEGORIES.includes(t.category)) {
          throw new AppError(`La transacción ${t.id} (${t.category}) no es un egreso reconciliable`, 400);
        }
        // Mismas guardas que reconcileCandidates: el filtro de candidatos no basta
        // porque reconcile() acepta ids arbitrarios.
        if (t.reversesTransactionId) {
          throw new AppError(`La transacción ${t.id} es el compensatorio de un reverso; no representa un pago real`, 400);
        }
        if (t.reversedBy.length > 0) {
          throw new AppError(`La transacción ${t.id} fue reversada; su dinero ya volvió a caja`, 400);
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

      for (const t of txs) {
        const amt = parseFloat(t.amount);

        const payment = await tx.debtPayment.create({
          data: {
            debtId, accountId: t.accountId, amount: amt,
            date: t.date, notes: 'Reconciliación de egreso histórico', createdBy: userId,
            reconciled: true,
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

  async reverseDebtPayment(paymentId, reason, userId) {
    const payment = await prisma.debtPayment.findUnique({
      where: { id: paymentId },
      include: {
        transactions: true,
        debt: { include: { installments: { orderBy: { sequence: 'asc' } } } },
      },
    });
    if (!payment) throw new AppError('Pago de crédito no encontrado', 404);
    if (payment.reversedAt) throw new AppError('Este pago ya fue reversado.', 409);
    if (payment.reconciled) {
      throw new AppError('Este pago proviene de una reconciliación de un egreso histórico; no se puede reversar como storno.', 400);
    }
    const debt = payment.debt;
    if (debt.status === 'CANCELLED') {
      throw new AppError('El crédito ya fue reversado por completo.', 400);
    }

    const sources = payment.transactions; // inmutables una vez creadas
    try {
      const result = await prisma.$transaction(async (tx) => {
        const freshPayments = await tx.debtPayment.findMany({ where: { debtId: debt.id } });
        const surviving = freshPayments.filter((p) => p.id !== paymentId && !p.reversedAt);
        const recompute = recomputeDebtFromPayments(debt, surviving);

        await applyReversalInTx(tx, {
          sources,
          reason,
          userId,
          category: 'DEBT_REVERSAL',
          auditEntityType: 'DEBT_PAYMENT',
          auditEntityId: paymentId,
        });
        await tx.debtPayment.update({
          where: { id: paymentId },
          data: { reversedAt: new Date(), reversedBy: userId, reverseReason: reason },
        });
        for (const u of recompute.installmentUpdates) {
          await tx.debtInstallment.update({
            where: { id: u.id },
            data: { paidAmount: u.paidAmount, status: u.status },
          });
        }
        return tx.debt.update({
          where: { id: debt.id },
          data: { paidAmount: recompute.paidAmount, status: recompute.status },
          include: DEBT_INCLUDE,
        });
      });
      return annotateOverdue(result);
    } catch (err) {
      if (err.code === 'P2002') throw new AppError(ALREADY_REVERSED, 409);
      throw err;
    }
  }
  async reverseDebt(debtId, reason, userId) {
    const debt = await prisma.debt.findUnique({
      where: { id: debtId },
      include: { installments: true },
    });
    if (!debt) throw new AppError('Crédito no encontrado', 404);
    if (debt.status === 'CANCELLED') throw new AppError('El crédito ya fue reversado.', 409);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const livePayments = await tx.debtPayment.findMany({
          where: { debtId, reversedAt: null },
          include: { transactions: true },
        });
        if (livePayments.some((p) => p.reconciled)) {
          throw new AppError('Este crédito tiene pagos reconciliados; gestiona esos egresos por separado, no se puede anular en cascada.', 400);
        }
        const sources = livePayments.flatMap((p) => p.transactions);
        if (sources.length === 0) {
          throw new AppError('El crédito no tiene movimientos para reversar.', 400);
        }

        await applyReversalInTx(tx, {
          sources,
          reason,
          userId,
          category: 'DEBT_REVERSAL',
          auditEntityType: 'DEBT',
          auditEntityId: debtId,
        });
        const now = new Date();
        for (const p of livePayments) {
          await tx.debtPayment.update({
            where: { id: p.id },
            data: { reversedAt: now, reversedBy: userId, reverseReason: reason },
          });
        }
        for (const inst of debt.installments) {
          await tx.debtInstallment.update({
            where: { id: inst.id },
            data: { paidAmount: 0, status: 'PENDING' },
          });
        }
        return tx.debt.update({
          where: { id: debtId },
          data: { paidAmount: 0, status: 'CANCELLED' },
          include: DEBT_INCLUDE,
        });
      });
      return annotateOverdue(result);
    } catch (err) {
      if (err.code === 'P2002') throw new AppError(ALREADY_REVERSED, 409);
      throw err;
    }
  }
}

module.exports = new DebtService();
module.exports.recomputeDebtStatus = recomputeDebtStatus;
module.exports.recomputeInstallmentStatus = recomputeInstallmentStatus;
module.exports.annotateOverdue = annotateOverdue;
module.exports.DEBT_INCLUDE = DEBT_INCLUDE;
