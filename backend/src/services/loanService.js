// ═══════════════════════════════════════════════════════════════
// Service — Loans (préstamos internos)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');
const { calcLoanInterest } = require('../utils/financial');

const LOAN_INCLUDE = {
  borrower: { select: { id: true, name: true, type: true } },
  originAccount: { select: { id: true, name: true, type: true } },
  installments: { orderBy: { sequence: 'asc' } },
  payments: {
    orderBy: { date: 'desc' },
    include: { account: { select: { id: true, name: true } } },
  },
};

function recomputeLoanStatus(principal, paid) {
  const p = parseFloat(principal);
  const q = parseFloat(paid);
  if (q <= 0) return 'PENDING';
  if (q >= p) return 'PAID';
  return 'PARTIAL';
}

function recomputeInstallmentStatus(planned, paid) {
  const p = parseFloat(planned);
  const q = parseFloat(paid);
  if (q <= 0) return 'PENDING';
  if (q >= p) return 'PAID';
  return 'PARTIAL';
}

function annotateOverdue(loan) {
  if (loan.status === 'PAID' || loan.status === 'CANCELLED') {
    return { ...loan, isOverdue: false };
  }
  const now = new Date();
  const isOverdue = loan.installments.some(
    (i) => i.status !== 'PAID' && new Date(i.dueDate) < now,
  );
  return { ...loan, isOverdue };
}

class LoanService {
  async create({ borrowerId, originAccountId, principalAmount, interestRate, description, notes, disbursementDate, installments }, userId) {
    const principal = parseFloat(principalAmount);
    const rate = parseFloat(interestRate) || 0;
    const interestAmount = calcLoanInterest(principal, rate);
    const totalToRepay = principal + interestAmount;

    const installmentsSum = installments.reduce((s, i) => s + parseFloat(i.plannedAmount), 0);
    if (Math.abs(installmentsSum - totalToRepay) > 0.01) {
      throw new AppError(`La suma de cuotas (${installmentsSum}) no coincide con el total a devolver (${totalToRepay})`, 400);
    }

    const sequences = installments.map((i) => i.sequence).sort((a, b) => a - b);
    for (let i = 0; i < sequences.length; i++) {
      if (sequences[i] !== i + 1) {
        throw new AppError('Las secuencias de cuotas deben ser 1..N sin huecos ni duplicados', 400);
      }
    }

    const borrower = await prisma.thirdParty.findUnique({ where: { id: borrowerId } });
    if (!borrower || !borrower.isActive) {
      throw new AppError('Deudor no encontrado o inactivo', 404);
    }

    const account = await prisma.account.findUnique({ where: { id: originAccountId } });
    if (!account || !account.isActive) {
      throw new AppError('Cuenta origen no encontrada o inactiva', 404);
    }

    const balance = await accountService.calculateBalance(originAccountId);
    if (balance < principal) {
      throw new AppError(`Saldo insuficiente en la cuenta origen (saldo: ${balance}, requerido: ${principal})`, 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          borrowerId,
          originAccountId,
          principalAmount: principal,
          interestRate: rate,
          interestAmount,
          description: description || null,
          notes: notes || null,
          disbursementDate: disbursementDate ? new Date(disbursementDate) : new Date(),
          createdBy: userId,
          installments: {
            create: installments.map((i) => ({
              sequence: i.sequence,
              dueDate: new Date(i.dueDate),
              plannedAmount: parseFloat(i.plannedAmount),
            })),
          },
        },
        include: LOAN_INCLUDE,
      });

      await tx.transaction.create({
        data: {
          accountId: originAccountId,
          type: 'EXPENSE',
          category: 'LOAN_DISBURSEMENT',
          amount: principal,
          description: `Préstamo a ${borrower.name}`,
          date: new Date(), // fecha de contabilización = instante de registro
          thirdPartyId: borrowerId,
          loanId: loan.id,
          createdBy: userId,
        },
      });

      return loan;
    });

    return annotateOverdue(result);
  }

  async list({ status, borrowerId, overdueOnly } = {}) {
    const where = {};
    if (status) where.status = status;
    if (borrowerId) where.borrowerId = borrowerId;
    const loans = await prisma.loan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: LOAN_INCLUDE,
    });
    const annotated = loans.map(annotateOverdue);
    return overdueOnly ? annotated.filter((l) => l.isOverdue) : annotated;
  }

  async findById(id) {
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: LOAN_INCLUDE,
    });
    if (!loan) throw new AppError('Préstamo no encontrado', 404);
    return annotateOverdue(loan);
  }

  async addPayment(loanId, { accountId, principalAmount, extraAmount, date, notes }, userId) {
    const principal = parseFloat(principalAmount || 0);
    const extra = parseFloat(extraAmount || 0);

    if (principal + extra <= 0) {
      throw new AppError('El pago debe tener monto > 0 (principal o extra)', 400);
    }

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: { installments: { orderBy: { sequence: 'asc' } }, borrower: true },
    });
    if (!loan) throw new AppError('Préstamo no encontrado', 404);
    if (loan.status === 'CANCELLED') throw new AppError('Préstamo cancelado', 400);
    if (loan.status === 'PAID') throw new AppError('Préstamo ya está totalmente pagado', 400);

    const remaining = parseFloat(loan.principalAmount) - parseFloat(loan.paidAmount);
    if (principal > remaining + 0.001) {
      throw new AppError(`El monto principal (${principal}) excede el saldo pendiente (${remaining}). Usá el campo extra para el sobrante.`, 400);
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || !account.isActive) throw new AppError('Cuenta destino no encontrada o inactiva', 404);

    let remainingPrincipal = principal;
    const installmentUpdates = [];
    for (const inst of loan.installments) {
      if (remainingPrincipal <= 0) break;
      const owed = parseFloat(inst.plannedAmount) - parseFloat(inst.paidAmount);
      if (owed <= 0) continue;
      const apply = Math.min(owed, remainingPrincipal);
      const newPaid = parseFloat(inst.paidAmount) + apply;
      installmentUpdates.push({
        id: inst.id,
        newPaid,
        newStatus: recomputeInstallmentStatus(inst.plannedAmount, newPaid),
      });
      remainingPrincipal -= apply;
    }

    const newLoanPaid = parseFloat(loan.paidAmount) + principal;
    const newLoanExtra = parseFloat(loan.extraReceived) + extra;
    const newLoanStatus = recomputeLoanStatus(loan.principalAmount, newLoanPaid);

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.loanPayment.create({
        data: {
          loanId,
          accountId,
          principalAmount: principal,
          extraAmount: extra,
          date: new Date(), // fecha de contabilización = instante de registro
          notes: notes || null,
          createdBy: userId,
        },
      });

      if (principal > 0) {
        await tx.transaction.create({
          data: {
            accountId,
            type: 'INCOME',
            category: 'LOAN_REPAYMENT',
            amount: principal,
            description: `Pago préstamo: ${loan.borrower.name}`,
            date: new Date(), // fecha de contabilización = instante de registro
            thirdPartyId: loan.borrowerId,
            loanId,
            loanPaymentId: payment.id,
            createdBy: userId,
          },
        });
      }

      if (extra > 0) {
        await tx.transaction.create({
          data: {
            accountId,
            type: 'INCOME',
            category: 'LOAN_EXTRA_INCOME',
            amount: extra,
            description: `Ingreso extra del préstamo: ${loan.borrower.name}`,
            date: new Date(), // fecha de contabilización = instante de registro
            thirdPartyId: loan.borrowerId,
            loanId,
            loanPaymentId: payment.id,
            createdBy: userId,
          },
        });
      }

      for (const u of installmentUpdates) {
        await tx.loanInstallment.update({
          where: { id: u.id },
          data: { paidAmount: u.newPaid, status: u.newStatus },
        });
      }

      const updatedLoan = await tx.loan.update({
        where: { id: loanId },
        data: {
          paidAmount: newLoanPaid,
          extraReceived: newLoanExtra,
          status: newLoanStatus,
        },
        include: LOAN_INCLUDE,
      });

      return updatedLoan;
    });

    return annotateOverdue(result);
  }

  async cancel(loanId) {
    const loan = await prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new AppError('Préstamo no encontrado', 404);
    if (loan.status !== 'PENDING') {
      throw new AppError('Solo se pueden cancelar préstamos sin pagos (status PENDING)', 400);
    }
    const updated = await prisma.loan.update({
      where: { id: loanId },
      data: { status: 'CANCELLED' },
      include: LOAN_INCLUDE,
    });
    return annotateOverdue(updated);
  }
}

module.exports = new LoanService();
module.exports.recomputeLoanStatus = recomputeLoanStatus;
module.exports.recomputeInstallmentStatus = recomputeInstallmentStatus;
module.exports.annotateOverdue = annotateOverdue;
module.exports.LOAN_INCLUDE = LOAN_INCLUDE;
