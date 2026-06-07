// ═══════════════════════════════════════════════════════════════
// Payable Service — Cuentas por Cobrar (CxC) y por Pagar (CxP)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');

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
    throw new Error('Cuenta por cobrar/pagar no encontrada');
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

  // Obtener la CxC/CxP
  const payable = await prisma.payable.findUnique({
    where: { id: payableId },
    include: { vehicle: true, thirdParty: true }
  });

  if (!payable) {
    throw new Error('Cuenta por cobrar/pagar no encontrada');
  }

  if (payable.status === 'PAID') {
    throw new Error('Esta cuenta ya esta completamente pagada');
  }

  if (payable.status === 'CANCELLED') {
    throw new Error('Esta cuenta fue cancelada');
  }

  const paymentAmount = parseFloat(amount);
  const currentPaid = parseFloat(payable.paidAmount);
  const total = parseFloat(payable.totalAmount);
  const remaining = total - currentPaid;

  if (paymentAmount > remaining) {
    throw new Error(`El monto excede el saldo pendiente de ${remaining}`);
  }

  const newPaidAmount = currentPaid + paymentAmount;
  const newStatus = newPaidAmount >= total ? 'PAID' : 'PARTIAL';

  // Determinar tipo y categoria de transaccion
  const isReceivable = payable.type === 'RECEIVABLE';
  const isCommission = payable.type === 'COMMISSION';
  const transactionType = isReceivable ? 'INCOME' : 'EXPENSE';
  // COMMISSION es un PAYABLE pero categoriza distinto: no es VEHICLE_PURCHASE,
  // es un egreso operativo por comisión al vendedor.
  const transactionCategory = isReceivable
    ? (payable.vehicleId ? 'VEHICLE_SALE_PARTIAL' : 'OTHER_INCOME')
    : isCommission
      ? 'COMMISSION'
      : (payable.vehicleId ? 'VEHICLE_PURCHASE' : 'OTHER_EXPENSE');

  // Transaccion atomica
  const result = await prisma.$transaction(async (tx) => {
    // 1. Crear la transaccion de tesoreria
    const transaction = await tx.transaction.create({
      data: {
        accountId,
        type: transactionType,
        category: transactionCategory,
        amount: paymentAmount,
        description: description || `Pago ${isReceivable ? 'recibido' : 'realizado'}: ${payable.description || ''}`,
        date: parseLocalDate(date),
        vehicleId: payable.vehicleId,
        thirdPartyId: payable.thirdPartyId,
        createdBy: userId
      }
    });

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

    return { payable: updatedPayable, transaction, payment };
  });

  return result;
};

/**
 * Cancelar una CxC/CxP
 */
const cancel = async (id, userId) => {
  const payable = await prisma.payable.findUnique({ where: { id } });

  if (!payable) {
    throw new Error('Cuenta por cobrar/pagar no encontrada');
  }

  if (payable.status === 'PAID') {
    throw new Error('No se puede cancelar una cuenta ya pagada');
  }

  if (parseFloat(payable.paidAmount) > 0) {
    throw new Error('No se puede cancelar una cuenta con pagos parciales');
  }

  const updated = await prisma.payable.update({
    where: { id },
    data: { status: 'CANCELLED' }
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

  // Total por pagar (CxP) — incluye PAYABLE de compras y COMMISSION de comisiones
  // ya devengadas. Ambas son deudas reales del negocio.
  const payables = await prisma.payable.aggregate({
    where: {
      type: { in: ['PAYABLE', 'COMMISSION'] },
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
      type: { in: ['PAYABLE', 'COMMISSION'] },
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

module.exports = {
  getAll,
  getById,
  create,
  addPayment,
  cancel,
  getSummary,
  getUpcoming
};
