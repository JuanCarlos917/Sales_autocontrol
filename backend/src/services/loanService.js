// ═══════════════════════════════════════════════════════════════
// Service — Loans (préstamos internos)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');

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
  async create({ borrowerId, originAccountId, principalAmount, description, notes, disbursementDate, installments }, userId) {
    const principal = parseFloat(principalAmount);

    const installmentsSum = installments.reduce((s, i) => s + parseFloat(i.plannedAmount), 0);
    if (Math.abs(installmentsSum - principal) > 0.01) {
      throw new AppError(`La suma de cuotas (${installmentsSum}) no coincide con el principal (${principal})`, 400);
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
          date: loan.disbursementDate,
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
}

module.exports = new LoanService();
module.exports.recomputeLoanStatus = recomputeLoanStatus;
module.exports.recomputeInstallmentStatus = recomputeInstallmentStatus;
module.exports.annotateOverdue = annotateOverdue;
module.exports.LOAN_INCLUDE = LOAN_INCLUDE;
