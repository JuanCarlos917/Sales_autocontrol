// ═══════════════════════════════════════════════════════════════
// Purchase Service — Flujo de compra de vehículos con tesorería
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

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
  const { purchasePrice, ...restVehicleData } = vehicleData;

  // Si no hay precio de compra, crear vehículo normal
  if (!purchasePrice || purchasePrice <= 0) {
    const vehicle = await prisma.vehicle.create({
      data: { ...vehicleData, userId },
      include: { expenses: true, documents: true }
    });
    return { vehicle, payable: null, transaction: null, warning: null };
  }

  // Transacción atómica para crear vehículo + CxP + pago opcional
  const result = await prisma.$transaction(async (tx) => {
    // 1. Crear el vehículo
    const vehicle = await tx.vehicle.create({
      data: {
        ...restVehicleData,
        purchasePrice,
        userId,
        stage: vehicleData.stage || 'COMPRADO',
        purchaseDate: vehicleData.purchaseDate || new Date()
      },
      include: { expenses: true, documents: true }
    });

    // 2. Crear la cuenta por pagar (CxP)
    const payable = await tx.payable.create({
      data: {
        type: 'PAYABLE',
        status: 'PENDING',
        totalAmount: purchasePrice,
        paidAmount: 0,
        description: `Compra vehículo ${vehicle.plate}`,
        vehicleId: vehicle.id,
        thirdPartyId: paymentData?.thirdPartyId || null,
        dueDate: paymentData?.dueDate ? new Date(paymentData.dueDate) : null,
        createdBy: userId
      }
    });

    let transaction = null;
    let warning = null;

    // 3. Si hay datos de pago, registrar el pago
    if (paymentData?.accountId && paymentData?.amount > 0) {
      const paymentAmount = parseFloat(paymentData.amount);

      // Verificar saldo de la cuenta (solo warning, no bloquear)
      const account = await tx.account.findUnique({
        where: { id: paymentData.accountId }
      });

      if (account) {
        // Calcular saldo actual
        const transactions = await tx.transaction.aggregate({
          where: { accountId: account.id },
          _sum: { amount: true }
        });

        const incomeSum = await tx.transaction.aggregate({
          where: { accountId: account.id, type: { in: ['INCOME', 'TRANSFER_IN'] } },
          _sum: { amount: true }
        });

        const expenseSum = await tx.transaction.aggregate({
          where: { accountId: account.id, type: { in: ['EXPENSE', 'TRANSFER_OUT'] } },
          _sum: { amount: true }
        });

        const currentBalance = parseFloat(account.initialBalance) +
          parseFloat(incomeSum._sum.amount || 0) -
          parseFloat(expenseSum._sum.amount || 0);

        if (currentBalance - paymentAmount < 0) {
          warning = {
            type: 'NEGATIVE_BALANCE',
            message: `La cuenta "${account.name}" quedará con saldo negativo después de este pago`,
            currentBalance,
            newBalance: currentBalance - paymentAmount
          };
        }
      }

      // Crear la transacción de egreso
      transaction = await tx.transaction.create({
        data: {
          accountId: paymentData.accountId,
          type: 'EXPENSE',
          category: 'VEHICLE_PURCHASE',
          amount: paymentAmount,
          description: `Pago compra ${vehicle.plate}`,
          date: paymentData.date ? new Date(paymentData.date) : new Date(),
          vehicleId: vehicle.id,
          thirdPartyId: paymentData.thirdPartyId || null,
          createdBy: userId
        }
      });

      // Crear registro de pago en PayablePayment
      await tx.payablePayment.create({
        data: {
          payableId: payable.id,
          transactionId: transaction.id,
          amount: paymentAmount
        }
      });

      // Actualizar estado del payable
      const newPaidAmount = paymentAmount;
      const newStatus = newPaidAmount >= purchasePrice ? 'PAID' : 'PARTIAL';

      await tx.payable.update({
        where: { id: payable.id },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus
        }
      });
    }

    return { vehicle, payable, transaction, warning };
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
        date: date ? new Date(date) : new Date(),
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

module.exports = {
  createVehicleWithPurchase,
  addPurchasePayment,
  getVehiclePaymentStatus
};
