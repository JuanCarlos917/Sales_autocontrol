// ═══════════════════════════════════════════════════════════════
// Purchase Service — Flujo de compra de vehículos con tesorería
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculateParticipation } = require('../utils/financial');

/**
 * Normaliza el payload de pago a una lista de líneas { accountId, amount, method }.
 * Acepta el formato dividido { payments: [...] } o el legacy { accountId, amount }.
 */
function normalizePayments(paymentData) {
  if (!paymentData) return [];
  if (Array.isArray(paymentData.payments)) {
    return paymentData.payments
      .filter(p => p && p.accountId && parseFloat(p.amount) > 0)
      .map(p => ({ accountId: p.accountId, amount: parseFloat(p.amount), method: p.method || null }));
  }
  if (paymentData.accountId && parseFloat(paymentData.amount) > 0) {
    return [{ accountId: paymentData.accountId, amount: parseFloat(paymentData.amount), method: null }];
  }
  return [];
}

/** Saldo actual de una cuenta = saldo inicial + ingresos - egresos. */
async function computeAccountBalance(tx, accountId) {
  const account = await tx.account.findUnique({ where: { id: accountId } });
  if (!account) return null;
  const incomeSum = await tx.transaction.aggregate({
    where: { accountId, type: { in: ['INCOME', 'TRANSFER_IN'] } },
    _sum: { amount: true },
  });
  const expenseSum = await tx.transaction.aggregate({
    where: { accountId, type: { in: ['EXPENSE', 'TRANSFER_OUT'] } },
    _sum: { amount: true },
  });
  const balance = parseFloat(account.initialBalance) +
    parseFloat(incomeSum._sum.amount || 0) -
    parseFloat(expenseSum._sum.amount || 0);
  return { account, balance };
}

/**
 * Aplica una o varias líneas de pago (efectivo/transferencia) contra la CxP de compra.
 * Crea una Transaction de egreso + PayablePayment por línea, valida que la suma no
 * exceda lo adeudado y actualiza paidAmount/status del payable. Devuelve avisos de
 * saldo negativo (no bloqueantes).
 */
async function applyPurchasePayments(tx, { payable, payments, vehicle, thirdPartyId, date, userId, owedAmount }) {
  if (!payments || payments.length === 0) {
    return { totalPaid: 0, transactions: [], warnings: [] };
  }

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  if (totalPaid > owedAmount + 0.0001) {
    throw new AppError(
      `El total de pagos (${totalPaid}) excede tu parte a pagar (${owedAmount})`,
      400
    );
  }

  const transactions = [];
  const warnings = [];
  const paymentDate = new Date(); // fecha de contabilización = instante de registro
  const methodLabel = { CASH: ' (efectivo)', TRANSFER: ' (transferencia)' };

  for (const p of payments) {
    const info = await computeAccountBalance(tx, p.accountId);
    if (!info) throw new AppError('La cuenta seleccionada no existe', 400);
    if (info.balance - p.amount < 0) {
      warnings.push({
        type: 'NEGATIVE_BALANCE',
        message: `La cuenta "${info.account.name}" quedará con saldo negativo después de este pago`,
        accountId: p.accountId,
        currentBalance: info.balance,
        newBalance: info.balance - p.amount,
      });
    }

    const transaction = await tx.transaction.create({
      data: {
        accountId: p.accountId,
        type: 'EXPENSE',
        category: 'VEHICLE_PURCHASE',
        amount: p.amount,
        description: `Pago compra ${vehicle.plate}${methodLabel[p.method] || ''}`,
        date: paymentDate,
        vehicleId: vehicle.id,
        thirdPartyId: thirdPartyId || null,
        createdBy: userId,
      },
    });
    await tx.payablePayment.create({
      data: { payableId: payable.id, transactionId: transaction.id, amount: p.amount },
    });
    transactions.push(transaction);
  }

  await tx.payable.update({
    where: { id: payable.id },
    data: { paidAmount: totalPaid, status: totalPaid >= owedAmount ? 'PAID' : 'PARTIAL' },
  });

  return { totalPaid, transactions, warnings };
}

/**
 * Crear vehículo con flujo de compra integrado a tesorería
 *
 * @param {Object} vehicleData - Datos del vehículo
 * @param {Object} paymentData - Datos de pago (opcional)
 * @param {string} paymentData.accountId - Cuenta de la que se paga
 * @param {number} paymentData.amount - Monto a pagar (puede ser parcial)
 * @param {string} paymentData.thirdPartyId - Tercero (vendedor)
 * @param {Date} paymentData.date - Fecha del pago
 * @param {string} userId - ID del usuario
 */
const createVehicleWithPurchase = async (vehicleData, paymentData, userId) => {
  const { purchasePrice, partnerContribution, participation: participationInput, ...restVehicleData } = vehicleData;

  // Auto-calcular participación si llega aporte del socio sin % explícito
  const participation = (participationInput !== undefined && participationInput !== null)
    ? participationInput
    : calculateParticipation(purchasePrice, partnerContribution);

  // Si no hay precio de compra, crear vehículo normal
  if (!purchasePrice || purchasePrice <= 0) {
    const vehicle = await prisma.vehicle.create({
      data: { ...vehicleData, participation, userId },
      include: { expenses: true, documents: true }
    });
    return { vehicle, payable: null, transaction: null, warning: null };
  }

  // Mi deuda efectiva al proveedor (descuenta el aporte del socio si existe)
  const partnerAmount = Number(partnerContribution || 0);
  const myOwedAmount = Math.max(0, Number(purchasePrice) - partnerAmount);

  // Transacción atómica para crear vehículo + CxP + pago opcional
  const result = await prisma.$transaction(async (tx) => {
    // 1. Crear el vehículo
    const vehicle = await tx.vehicle.create({
      data: {
        ...restVehicleData,
        purchasePrice,
        partnerContribution: partnerAmount > 0 ? partnerAmount : null,
        participation,
        userId,
        stage: vehicleData.stage || 'COMPRADO',
        purchaseDate: vehicleData.purchaseDate || new Date()
      },
      include: { expenses: true, documents: true }
    });

    // 2. Crear la cuenta por pagar (CxP) — solo por MI parte
    const payable = await tx.payable.create({
      data: {
        type: 'PAYABLE',
        status: 'PENDING',
        totalAmount: myOwedAmount,
        paidAmount: 0,
        description: partnerAmount > 0
          ? `Compra vehículo ${vehicle.plate} (mi parte)`
          : `Compra vehículo ${vehicle.plate}`,
        vehicleId: vehicle.id,
        thirdPartyId: paymentData?.thirdPartyId || null,
        dueDate: paymentData?.dueDate ? new Date(paymentData.dueDate) : null,
        createdBy: userId
      }
    });

    // 3. Aplicar pago(s): efectivo y/o transferencia (o ninguno → todo a CxP)
    const payments = normalizePayments(paymentData);
    const { transactions, warnings } = await applyPurchasePayments(tx, {
      payable,
      payments,
      vehicle,
      thirdPartyId: paymentData?.thirdPartyId || null,
      date: paymentData?.date,
      userId,
      owedAmount: myOwedAmount,
    });

    return { vehicle, payable, transaction: transactions[0] || null, transactions, warning: warnings[0] || null, warnings };
  });

  // Obtener el payable actualizado con relaciones
  const updatedPayable = await prisma.payable.findUnique({
    where: { id: result.payable.id },
    include: {
      payments: {
        include: {
          transaction: { select: { id: true, date: true, amount: true } }
        }
      }
    }
  });

  return { ...result, payable: updatedPayable };
};

/**
 * Registrar pago adicional a la compra de un vehículo
 */
const addPurchasePayment = async (vehicleId, paymentData, userId) => {
  // Buscar el payable asociado al vehículo
  const payable = await prisma.payable.findFirst({
    where: {
      vehicleId,
      type: 'PAYABLE',
      status: { in: ['PENDING', 'PARTIAL'] }
    }
  });

  if (!payable) {
    throw new AppError('No hay saldo pendiente por pagar para este vehículo', 400);
  }

  const { accountId, amount, date, description } = paymentData;
  const paymentAmount = parseFloat(amount);
  const currentPaid = parseFloat(payable.paidAmount);
  const total = parseFloat(payable.totalAmount);
  const remaining = total - currentPaid;

  if (paymentAmount > remaining) {
    throw new AppError(`El monto excede el saldo pendiente de ${remaining}`, 400);
  }

  // Verificar saldo de cuenta (warning only)
  let warning = null;
  const account = await prisma.account.findUnique({ where: { id: accountId } });

  if (account) {
    const incomeSum = await prisma.transaction.aggregate({
      where: { accountId: account.id, type: { in: ['INCOME', 'TRANSFER_IN'] } },
      _sum: { amount: true }
    });
    const expenseSum = await prisma.transaction.aggregate({
      where: { accountId: account.id, type: { in: ['EXPENSE', 'TRANSFER_OUT'] } },
      _sum: { amount: true }
    });
    const currentBalance = parseFloat(account.initialBalance) +
      parseFloat(incomeSum._sum.amount || 0) -
      parseFloat(expenseSum._sum.amount || 0);

    if (currentBalance - paymentAmount < 0) {
      warning = {
        type: 'NEGATIVE_BALANCE',
        message: `La cuenta "${account.name}" quedará con saldo negativo`,
        currentBalance,
        newBalance: currentBalance - paymentAmount
      };
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Obtener vehículo para descripción
    const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });

    // Crear transacción
    const transaction = await tx.transaction.create({
      data: {
        accountId,
        type: 'EXPENSE',
        category: 'VEHICLE_PURCHASE',
        amount: paymentAmount,
        description: description || `Pago compra ${vehicle?.plate || ''}`,
        date: new Date(), // fecha de contabilización = instante de registro
        vehicleId,
        thirdPartyId: payable.thirdPartyId,
        createdBy: userId
      }
    });

    // Crear PayablePayment
    await tx.payablePayment.create({
      data: {
        payableId: payable.id,
        transactionId: transaction.id,
        amount: paymentAmount
      }
    });

    // Actualizar payable
    const newPaidAmount = currentPaid + paymentAmount;
    const newStatus = newPaidAmount >= total ? 'PAID' : 'PARTIAL';

    const updatedPayable = await tx.payable.update({
      where: { id: payable.id },
      data: {
        paidAmount: newPaidAmount,
        status: newStatus
      },
      include: {
        payments: {
          include: {
            transaction: { select: { id: true, date: true, amount: true } }
          }
        }
      }
    });

    return { payable: updatedPayable, transaction };
  });

  return { ...result, warning };
};

/**
 * Obtener estado de pago de un vehículo
 */
const getVehiclePaymentStatus = async (vehicleId) => {
  const payables = await prisma.payable.findMany({
    where: { vehicleId },
    include: {
      payments: {
        include: {
          transaction: {
            select: { id: true, date: true, amount: true, account: { select: { name: true } } }
          }
        },
        orderBy: { createdAt: 'desc' }
      },
      thirdParty: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  const purchase = payables.find(p => p.type === 'PAYABLE');
  const sale = payables.find(p => p.type === 'RECEIVABLE');

  return {
    purchase: purchase ? {
      ...purchase,
      pendingAmount: parseFloat(purchase.totalAmount) - parseFloat(purchase.paidAmount)
    } : null,
    sale: sale ? {
      ...sale,
      pendingAmount: parseFloat(sale.totalAmount) - parseFloat(sale.paidAmount)
    } : null
  };
};

/**
 * Confirmar compra de un vehículo (en NEGOCIANDO o en COMPRADO sin CxP registrada):
 *   - Actualiza stage → COMPRADO + purchasePrice + proveedor/socio
 *   - Crea la CxP (cuenta por pagar)
 *   - Opcionalmente registra un pago desde una cuenta de tesorería
 */
const confirmPurchase = async (vehicleId, vehicleData, paymentData, userId) => {
  const existing = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
  if (!existing) throw new AppError('Vehículo no encontrado', 404);
  if (existing.stage !== 'NEGOCIANDO' && existing.stage !== 'COMPRADO') {
    throw new AppError('Solo puedes confirmar la compra desde Negociando o Comprado', 400);
  }
  // Si ya está en COMPRADO, solo se permite si aún no hay CxP asociada
  if (existing.stage === 'COMPRADO') {
    const existingPayable = await prisma.payable.findFirst({
      where: { vehicleId, type: 'PAYABLE' },
    });
    if (existingPayable) {
      throw new AppError('La compra de este vehículo ya fue registrada', 400);
    }
  }

  const purchasePrice = parseFloat(vehicleData?.purchasePrice);
  if (!purchasePrice || purchasePrice <= 0) {
    throw new AppError('Debes definir el Precio de Compra para pasar a Comprado', 400);
  }

  const partnerAmount = Number(vehicleData?.partnerContribution || 0);
  const participation = (vehicleData?.participation !== undefined && vehicleData?.participation !== null)
    ? Number(vehicleData.participation)
    : calculateParticipation(purchasePrice, partnerAmount);
  const myOwedAmount = Math.max(0, purchasePrice - partnerAmount);
  const supplierId = vehicleData?.supplierId || existing.supplierId || paymentData?.thirdPartyId || null;

  const result = await prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.update({
      where: { id: vehicleId },
      data: {
        stage: 'COMPRADO',
        purchasePrice,
        purchaseDate: vehicleData?.purchaseDate ? new Date(vehicleData.purchaseDate) : (existing.purchaseDate || new Date()),
        listedPrice: vehicleData?.listedPrice ?? existing.listedPrice ?? null,
        supplierId,
        partnerId: vehicleData?.partnerId ?? existing.partnerId ?? null,
        partnerContribution: partnerAmount > 0 ? partnerAmount : null,
        participation,
        partnerAssumesExpenses: vehicleData?.partnerAssumesExpenses ?? existing.partnerAssumesExpenses,
        notes: vehicleData?.notes ?? existing.notes,
      },
      include: { expenses: true, documents: true },
    });

    const payable = await tx.payable.create({
      data: {
        type: 'PAYABLE',
        status: 'PENDING',
        totalAmount: myOwedAmount,
        paidAmount: 0,
        description: partnerAmount > 0
          ? `Compra vehículo ${vehicle.plate} (mi parte)`
          : `Compra vehículo ${vehicle.plate}`,
        vehicleId: vehicle.id,
        thirdPartyId: supplierId,
        dueDate: paymentData?.dueDate ? new Date(paymentData.dueDate) : null,
        createdBy: userId,
      },
    });

    // Aplicar pago(s): efectivo y/o transferencia (o ninguno → todo a CxP)
    const payments = normalizePayments(paymentData);
    const { transactions, warnings } = await applyPurchasePayments(tx, {
      payable,
      payments,
      vehicle,
      thirdPartyId: supplierId,
      date: paymentData?.date,
      userId,
      owedAmount: myOwedAmount,
    });

    return { vehicle, payable, transaction: transactions[0] || null, transactions, warning: warnings[0] || null, warnings };
  });

  return result;
};

module.exports = {
  createVehicleWithPurchase,
  addPurchasePayment,
  getVehiclePaymentStatus,
  confirmPurchase,
};
