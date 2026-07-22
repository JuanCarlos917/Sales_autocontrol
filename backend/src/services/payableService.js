// ═══════════════════════════════════════════════════════════════
// Payable Service — Cuentas por Cobrar (CxC) y por Pagar (CxP)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');
const { writeTreasuryAudit, snapshotEntity } = require('../utils/treasuryAudit');
const { lockRow } = require('../utils/txLocks');
const { buildPaymentTransactions } = require('./payablePaymentEntries');

const PAYABLE_AUDIT_FIELDS = [
  'id', 'type', 'vehicleId', 'thirdPartyId', 'totalAmount', 'paidAmount',
  'status', 'description', 'dueDate', 'createdAt',
];

// Prefijo de la CxC de comisión que el socio adeuda al fondo. Distingue esta
// RECEIVABLE de la CxC de venta ("Venta vehículo …"), igual que isSaleReceivable.
const SOCIO_COMMISSION_PREFIX = 'Comisión socio venta';

// Parsea una fecha string (YYYY-MM-DD) a Date en zona horaria de Colombia
// Evita el problema de que new Date("2026-04-19") se interprete como UTC
const parseLocalDate = (dateStr) => {
  if (!dateStr) return new Date();
  // Si es un string de fecha simple (YYYY-MM-DD), agregar hora del mediodia
  // para evitar problemas de zona horaria
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + 'T12:00:00');
  }
  return new Date(dateStr);
};

/**
 * Obtener todas las CxC/CxP con filtros
 */
const getAll = async (filters = {}) => {
  const { type, status, vehicleId, thirdPartyId, overdue } = filters;

  const where = {};

  if (type) where.type = type;
  if (status) where.status = status;
  if (vehicleId) where.vehicleId = vehicleId;
  if (thirdPartyId) where.thirdPartyId = thirdPartyId;

  // Filtrar vencidos (dueDate < hoy y status != PAID)
  if (overdue === 'true' || overdue === true) {
    where.dueDate = { lt: new Date() };
    where.status = { not: 'PAID' };
  }

  const payables = await prisma.payable.findMany({
    where,
    include: {
      vehicle: { select: { id: true, plate: true, brand: true, model: true, year: true } },
      expense: { select: { id: true, category: true, description: true } },
      thirdParty: { select: { id: true, name: true, type: true } },
      // Para CxP COMMISSION: exponer el rol (CAPTADOR/CERRADOR) y % aplicado
      // para que el cliente pueda agrupar/sumar por rol sin parsear descripciones.
      saleParticipant: { select: { role: true, sharePct: true } },
      payments: {
        include: {
          transaction: { select: { id: true, date: true, account: { select: { name: true } } } }
        }
      }
    },
    orderBy: [
      { status: 'asc' },
      { dueDate: 'asc' },
      { createdAt: 'desc' }
    ]
  });

  return payables;
};

/**
 * Obtener una CxC/CxP por ID
 */
const getById = async (id) => {
  const payable = await prisma.payable.findUnique({
    where: { id },
    include: {
      vehicle: { select: { id: true, plate: true, brand: true, model: true, year: true } },
      expense: { select: { id: true, category: true, description: true } },
      thirdParty: { select: { id: true, name: true, type: true } },
      payments: {
        include: {
          transaction: {
            select: {
              id: true,
              date: true,
              amount: true,
              description: true,
              account: { select: { id: true, name: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!payable) {
    throw new AppError('Cuenta por cobrar/pagar no encontrada', 404);
  }

  return payable;
};

/**
 * Crear una nueva CxC/CxP
 */
const create = async (data, userId) => {
  const { type, totalAmount, dueDate, description, vehicleId, expenseId, thirdPartyId } = data;

  const payable = await prisma.payable.create({
    data: {
      type,
      totalAmount,
      paidAmount: 0,
      status: 'PENDING',
      dueDate: dueDate ? new Date(dueDate) : null,
      description,
      vehicleId: vehicleId || null,
      expenseId: expenseId || null,
      thirdPartyId: thirdPartyId || null,
      createdBy: userId
    },
    include: {
      vehicle: { select: { id: true, plate: true } },
      thirdParty: { select: { id: true, name: true } }
    }
  });

  return payable;
};

/**
 * Registrar un pago a una CxC/CxP
 * Crea la transaccion y actualiza el estado
 */
const addPayment = async (payableId, paymentData, userId) => {
  const { accountId, amount, date, description } = paymentData;
  const paymentAmount = parseFloat(amount);

  // Guardas de cuenta (auditoría 🟠 #2): debe existir y estar activa.
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) {
    throw new AppError('Cuenta no encontrada', 404);
  }
  if (!account.isActive) {
    throw new AppError('La cuenta está desactivada; no admite movimientos', 400);
  }

  // Transaccion atomica con lectura autoritativa (anti-TOCTOU, auditoría 🟠 #3/#4):
  // el payable y el saldo se leen DENTRO de la tx con sus filas bloqueadas —
  // dos pagos concurrentes quedan serializados. Orden de locks: payable → cuenta.
  const result = await prisma.$transaction(async (tx) => {
    await lockRow(tx, 'payable', payableId);
    await lockRow(tx, 'account', accountId);

    const payable = await tx.payable.findUnique({
      where: { id: payableId },
      include: { vehicle: true, thirdParty: true }
    });

    if (!payable) {
      throw new AppError('Cuenta por cobrar/pagar no encontrada', 404);
    }

    if (payable.status === 'PAID') {
      throw new AppError('Esta cuenta ya esta completamente pagada', 400);
    }

    if (payable.status === 'CANCELLED') {
      throw new AppError('Esta cuenta fue cancelada', 400);
    }

    const currentPaid = parseFloat(payable.paidAmount);
    const total = parseFloat(payable.totalAmount);
    const remaining = total - currentPaid;

    if (paymentAmount > remaining) {
      throw new AppError(`El monto excede el saldo pendiente de ${remaining}`, 400);
    }

    const newPaidAmount = currentPaid + paymentAmount;
    const newStatus = newPaidAmount >= total ? 'PAID' : 'PARTIAL';

    // Determinar tipo y categoria de transaccion
    const isReceivable = payable.type === 'RECEIVABLE';

    // Egresos (CxP/comisiones): saldo suficiente, leído con la cuenta bloqueada.
    if (!isReceivable) {
      const balance = await accountService.calculateBalance(accountId, tx);
      if (balance < paymentAmount) {
        throw new AppError(`Saldo insuficiente en la cuenta (saldo: ${balance}, requerido: ${paymentAmount})`, 400);
      }
    }
    const isCommission = payable.type === 'COMMISSION';
    const isProfitShare = payable.type === 'PROFIT_SHARE';
    const isPartnerShare = payable.type === 'PARTNER_SHARE';
    const isCapitalReturn = payable.type === 'CAPITAL_RETURN';
    const isCommissionReturn = payable.type === 'COMMISSION_RETURN';
    const transactionType = isReceivable ? 'INCOME' : 'EXPENSE';
    // COMMISSION, PROFIT_SHARE, PARTNER_SHARE, CAPITAL_RETURN y COMMISSION_RETURN
    // son PAYABLE pero categorizan distinto: no son VEHICLE_PURCHASE (contaminarían
    // el costo del vehículo). COMMISSION es egreso por comisión al vendedor;
    // PROFIT_SHARE es reparto de ganancia al inversionista; PARTNER_SHARE es la
    // ganancia que se le paga al socio del carro; CAPITAL_RETURN es la devolución
    // del capital aportado por el socio; COMMISSION_RETURN es la comisión que el
    // socio debe devolver al fondo.
    const transactionCategory = isReceivable
      ? (payable.vehicleId ? 'VEHICLE_SALE_PARTIAL' : 'OTHER_INCOME')
      : isCommission
        ? 'COMMISSION'
        : isProfitShare
          ? 'PROFIT_SHARE'
          : isPartnerShare
            ? 'PARTNER_SHARE'
            : isCapitalReturn
              ? 'CAPITAL_RETURN'
              : isCommissionReturn
                ? 'COMMISSION_RETURN'
                : (payable.vehicleId ? 'VEHICLE_PURCHASE' : 'OTHER_EXPENSE');

    // Enrutamiento FASE B: si la CxP no es RECEIVABLE y el tercero tiene una
    // cuenta SOCIO activa, el pago sale de la cuenta de la empresa y entra a
    // la cuenta del socio, preservando la categoría en ambos asientos.
    const socioAccount = (!isReceivable && payable.thirdPartyId)
      ? await tx.account.findFirst({
          where: { type: 'SOCIO', thirdPartyId: payable.thirdPartyId, isActive: true },
        })
      : null;

    const { entries, paymentTransactionIndex } = buildPaymentTransactions({
      transactionType,
      transactionCategory,
      accountId,
      socioAccount,
      isReceivable,
      paymentAmount,
      description,
      payableDescription: payable.description,
      date: parseLocalDate(date),
      vehicleId: payable.vehicleId,
      thirdPartyId: payable.thirdPartyId,
      userId,
    });

    // 1. Crear la(s) transaccion(es) de tesoreria
    const createdTransactions = [];
    for (const data of entries) {
      createdTransactions.push(await tx.transaction.create({ data }));
    }
    // La transacción que salda la CxP (egreso/único asiento) liga el pago.
    const transaction = createdTransactions[paymentTransactionIndex];

    // 2. Crear el registro de pago
    const payment = await tx.payablePayment.create({
      data: {
        payableId,
        transactionId: transaction.id,
        amount: paymentAmount
      }
    });

    // 3. Actualizar la CxC/CxP
    const updatedPayable = await tx.payable.update({
      where: { id: payableId },
      data: {
        paidAmount: newPaidAmount,
        status: newStatus
      },
      include: {
        vehicle: { select: { id: true, plate: true } },
        thirdParty: { select: { id: true, name: true } },
        payments: {
          include: {
            transaction: { select: { id: true, date: true, amount: true } }
          }
        }
      }
    });

    await writeTreasuryAudit(tx, {
      entityType: 'PAYABLE_PAYMENT',
      entityId: payment.id,
      userId,
      action: 'PAYMENT',
      after: {
        payableId,
        amount: paymentAmount,
        transactionId: transaction.id,
        accountId,
        date: parseLocalDate(date).toISOString(),
        previousPaidAmount: currentPaid,
        newPaidAmount,
        newStatus,
      },
    });

    return { payable: updatedPayable, transaction, payment };
  });

  return result;
};

/**
 * Cancelar una CxC/CxP
 */
const cancel = async (id, userId, { reason } = {}) => {
  if (!reason || reason.trim().length < 10) {
    throw new AppError('Debe indicar un motivo (mín 10 caracteres) para cancelar esta cuenta', 400);
  }

  const payable = await prisma.payable.findUnique({ where: { id } });

  if (!payable) {
    throw new AppError('Cuenta por cobrar/pagar no encontrada', 404);
  }

  if (payable.status === 'PAID') {
    throw new AppError('No se puede cancelar una cuenta ya pagada', 400);
  }

  if (parseFloat(payable.paidAmount) > 0) {
    throw new AppError('No se puede cancelar una cuenta con pagos parciales', 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.payable.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });
    await writeTreasuryAudit(tx, {
      entityType: 'PAYABLE',
      entityId: id,
      userId,
      action: 'CANCEL',
      before: snapshotEntity(payable, PAYABLE_AUDIT_FIELDS),
      after: snapshotEntity(u, PAYABLE_AUDIT_FIELDS),
      reason,
    });
    return u;
  });

  return updated;
};

/**
 * Obtener resumen de CxC/CxP
 */
const getSummary = async () => {
  const now = new Date();

  // Total por cobrar (CxC)
  const receivables = await prisma.payable.aggregate({
    where: {
      type: 'RECEIVABLE',
      status: { in: ['PENDING', 'PARTIAL'] }
    },
    _sum: { totalAmount: true, paidAmount: true },
    _count: true
  });

  // Total por pagar (CxP) — incluye PAYABLE de compras, COMMISSION de comisiones,
  // PROFIT_SHARE de ganancia a inversionistas, PARTNER_SHARE de ganancia de socio
  // ya devengadas y CAPITAL_RETURN de devolución de capital al socio. Las cinco
  // son deudas reales del negocio.
  const payables = await prisma.payable.aggregate({
    where: {
      type: { in: ['PAYABLE', 'COMMISSION', 'PROFIT_SHARE', 'PARTNER_SHARE', 'CAPITAL_RETURN', 'COMMISSION_RETURN'] },
      status: { in: ['PENDING', 'PARTIAL'] }
    },
    _sum: { totalAmount: true, paidAmount: true },
    _count: true
  });

  // Vencidos
  const overdueReceivables = await prisma.payable.count({
    where: {
      type: 'RECEIVABLE',
      status: { in: ['PENDING', 'PARTIAL'] },
      dueDate: { lt: now }
    }
  });

  const overduePayables = await prisma.payable.count({
    where: {
      type: { in: ['PAYABLE', 'COMMISSION', 'PROFIT_SHARE', 'PARTNER_SHARE', 'CAPITAL_RETURN', 'COMMISSION_RETURN'] },
      status: { in: ['PENDING', 'PARTIAL'] },
      dueDate: { lt: now }
    }
  });

  const totalReceivable = parseFloat(receivables._sum.totalAmount || 0) - parseFloat(receivables._sum.paidAmount || 0);
  const totalPayable = parseFloat(payables._sum.totalAmount || 0) - parseFloat(payables._sum.paidAmount || 0);

  return {
    receivables: {
      total: totalReceivable,
      count: receivables._count,
      overdueCount: overdueReceivables
    },
    payables: {
      total: totalPayable,
      count: payables._count,
      overdueCount: overduePayables
    },
    netPosition: totalReceivable - totalPayable
  };
};

/**
 * Obtener CxC/CxP proximas a vencer (7 dias)
 */
const getUpcoming = async (days = 7) => {
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  const upcoming = await prisma.payable.findMany({
    where: {
      status: { in: ['PENDING', 'PARTIAL'] },
      dueDate: {
        gte: now,
        lte: futureDate
      }
    },
    include: {
      vehicle: { select: { id: true, plate: true } },
      thirdParty: { select: { id: true, name: true } }
    },
    orderBy: { dueDate: 'asc' }
  });

  return upcoming;
};

/**
 * Pendientes de socio: ganancia por pagar (PARTNER_SHARE) y comisión por
 * cobrar (RECEIVABLE "Comisión socio venta"), agrupadas por vehículo.
 */
const getSocioPending = async () => {
  const PENDING = { in: ['PENDING', 'PARTIAL'] };
  const include = {
    vehicle: { select: { id: true, plate: true, brand: true, model: true } },
    thirdParty: { select: { id: true, name: true } },
  };

  const [capitalRows, profitRows, commissionReturnRows, commissionRows] = await Promise.all([
    prisma.payable.findMany({
      where: { type: 'CAPITAL_RETURN', status: PENDING },
      include,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payable.findMany({
      where: { type: 'PARTNER_SHARE', status: PENDING },
      include,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payable.findMany({
      where: { type: 'COMMISSION_RETURN', status: PENDING },
      include,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payable.findMany({
      where: {
        type: 'RECEIVABLE',
        status: PENDING,
        description: { startsWith: SOCIO_COMMISSION_PREFIX },
      },
      include,
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const toBucket = (payables) => {
    const items = payables.map((p) => {
      const totalAmount = parseFloat(p.totalAmount);
      const paidAmount = parseFloat(p.paidAmount);
      return {
        id: p.id,
        vehicleId: p.vehicleId,
        vehicle: p.vehicle,
        thirdParty: p.thirdParty,
        totalAmount,
        paidAmount,
        pending: totalAmount - paidAmount,
      };
    });
    return {
      total: items.reduce((sum, it) => sum + it.pending, 0),
      count: items.length,
      items,
    };
  };

  return {
    capital: toBucket(capitalRows),
    profit: toBucket(profitRows),
    commissionReturn: toBucket(commissionReturnRows),
    commission: toBucket(commissionRows),
  };
};

module.exports = {
  getAll,
  getById,
  create,
  addPayment,
  cancel,
  getSummary,
  getUpcoming,
  getSocioPending
};
