// ═══════════════════════════════════════════════════════════════
// Sale Service — Flujo de venta de vehículos con tesorería
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

/**
 * Tipos de pago de venta
 * - CASH: Efectivo (ingreso directo)
 * - TRANSFER: Transferencia bancaria (ingreso directo)
 * - TRADE_IN: Cruce de vehículo (crea nuevo vehículo + diferencia)
 * - FINANCED: Financiado (crea CxC por el total)
 * - MIXED: Combinación (pago parcial + CxC por el resto)
 */

/**
 * Registrar venta de vehículo con flujo de tesorería
 *
 * @param {string} vehicleId - ID del vehículo a vender
 * @param {Object} saleData - Datos de la venta
 * @param {number} saleData.salePrice - Precio de venta
 * @param {string} saleData.paymentType - Tipo de pago (CASH, TRANSFER, TRADE_IN, FINANCED, MIXED)
 * @param {Object} saleData.cashPayment - Pago en efectivo/transferencia
 * @param {Object} saleData.tradeIn - Datos del vehículo recibido en cruce
 * @param {Object} saleData.financing - Datos de financiamiento/CxC
 * @param {string} saleData.thirdPartyId - Cliente (tercero)
 * @param {string} userId - ID del usuario
 */
const registerSale = async (vehicleId, saleData, userId) => {
  const {
    salePrice,
    paymentType,
    cashPayment,
    tradeIn,
    financing,
    thirdPartyId,
    saleDate
  } = saleData;

  // Obtener el vehículo
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: { expenses: true }
  });

  if (!vehicle) {
    throw new AppError('Vehículo no encontrado', 404);
  }

  if (vehicle.stage === 'VENDIDO') {
    throw new AppError('Este vehículo ya fue vendido', 400);
  }

  const salePriceNum = parseFloat(salePrice);
  let totalReceived = 0;
  let pendingAmount = salePriceNum;

  const result = await prisma.$transaction(async (tx) => {
    const transactions = [];
    let newVehicle = null;
    let receivable = null;

    // 1. Actualizar el vehículo como vendido
    const updatedVehicle = await tx.vehicle.update({
      where: { id: vehicleId },
      data: {
        stage: 'VENDIDO',
        salePrice: salePriceNum,
        saleDate: saleDate ? new Date(saleDate) : new Date(),
        // Si hay cruce, guardar datos
        receivedVehicle: tradeIn ? true : false,
        receivedVehiclePlate: tradeIn?.plate || null,
        receivedVehicleValue: tradeIn?.value || null
      },
      include: { expenses: true, documents: true }
    });

    // 2. Procesar pago en efectivo/transferencia
    if (cashPayment?.accountId && cashPayment?.amount > 0) {
      const cashAmount = parseFloat(cashPayment.amount);
      totalReceived += cashAmount;
      pendingAmount -= cashAmount;

      const transaction = await tx.transaction.create({
        data: {
          accountId: cashPayment.accountId,
          type: 'INCOME',
          category: 'VEHICLE_SALE',
          amount: cashAmount,
          description: `Venta vehículo ${vehicle.plate}`,
          date: saleDate ? new Date(saleDate) : new Date(),
          vehicleId: vehicleId,
          thirdPartyId: thirdPartyId || null,
          createdBy: userId
        }
      });
      transactions.push(transaction);
    }

    // 3. Procesar cruce de vehículo
    if (tradeIn?.plate && tradeIn?.value > 0) {
      const tradeInValue = parseFloat(tradeIn.value);
      totalReceived += tradeInValue;
      pendingAmount -= tradeInValue;

      // Crear el nuevo vehículo recibido en cruce
      newVehicle = await tx.vehicle.create({
        data: {
          plate: tradeIn.plate,
          brand: tradeIn.brand || null,
          model: tradeIn.model || null,
          year: tradeIn.year || null,
          color: tradeIn.color || null,
          km: tradeIn.km || null,
          stage: 'COMPRADO',
          purchasePrice: tradeInValue,
          purchaseDate: saleDate ? new Date(saleDate) : new Date(),
          notes: `Recibido en cruce por venta de ${vehicle.plate}`,
          userId: vehicle.userId
        }
      });

      // Crear CxP para el vehículo recibido (ya está "pagado" con el cruce)
      await tx.payable.create({
        data: {
          type: 'PAYABLE',
          status: 'PAID',
          totalAmount: tradeInValue,
          paidAmount: tradeInValue,
          description: `Cruce recibido: ${tradeIn.plate} por venta de ${vehicle.plate}`,
          vehicleId: newVehicle.id,
          createdBy: userId
        }
      });
    }

    // 4. Crear CxC si hay saldo pendiente
    if (pendingAmount > 0) {
      receivable = await tx.payable.create({
        data: {
          type: 'RECEIVABLE',
          status: totalReceived > 0 ? 'PARTIAL' : 'PENDING',
          totalAmount: salePriceNum,
          paidAmount: totalReceived,
          dueDate: financing?.dueDate ? new Date(financing.dueDate) : null,
          description: `Venta vehículo ${vehicle.plate}`,
          vehicleId: vehicleId,
          thirdPartyId: thirdPartyId || null,
          createdBy: userId
        }
      });

      // Si hubo pagos, crear los PayablePayments
      for (const tx_record of transactions) {
        await tx.payablePayment.create({
          data: {
            payableId: receivable.id,
            transactionId: tx_record.id,
            amount: tx_record.amount
          }
        });
      }
    }

    return {
      vehicle: updatedVehicle,
      transactions,
      newVehicle,
      receivable,
      summary: {
        salePrice: salePriceNum,
        totalReceived,
        pendingAmount: pendingAmount > 0 ? pendingAmount : 0,
        tradeInValue: tradeIn?.value || 0
      }
    };
  });

  return result;
};

/**
 * Registrar cobro de venta (pago a CxC)
 */
const addSaleCollection = async (vehicleId, collectionData, userId) => {
  // Buscar el receivable asociado al vehículo
  const receivable = await prisma.payable.findFirst({
    where: {
      vehicleId,
      type: 'RECEIVABLE',
      status: { in: ['PENDING', 'PARTIAL'] }
    }
  });

  if (!receivable) {
    throw new AppError('No hay saldo pendiente por cobrar para este vehículo', 400);
  }

  const { accountId, amount, date, description } = collectionData;
  const collectionAmount = parseFloat(amount);
  const currentPaid = parseFloat(receivable.paidAmount);
  const total = parseFloat(receivable.totalAmount);
  const remaining = total - currentPaid;

  if (collectionAmount > remaining) {
    throw new AppError(`El monto excede el saldo pendiente de ${remaining}`, 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    // Obtener vehículo para descripción
    const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });

    // Crear transacción de ingreso
    const transaction = await tx.transaction.create({
      data: {
        accountId,
        type: 'INCOME',
        category: 'VEHICLE_SALE_PARTIAL',
        amount: collectionAmount,
        description: description || `Cobro venta ${vehicle?.plate || ''}`,
        date: date ? new Date(date) : new Date(),
        vehicleId,
        thirdPartyId: receivable.thirdPartyId,
        createdBy: userId
      }
    });

    // Crear PayablePayment
    await tx.payablePayment.create({
      data: {
        payableId: receivable.id,
        transactionId: transaction.id,
        amount: collectionAmount
      }
    });

    // Actualizar receivable
    const newPaidAmount = currentPaid + collectionAmount;
    const newStatus = newPaidAmount >= total ? 'PAID' : 'PARTIAL';

    const updatedReceivable = await tx.payable.update({
      where: { id: receivable.id },
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

    return { receivable: updatedReceivable, transaction };
  });

  return result;
};

/**
 * Obtener resumen de venta de un vehículo
 */
const getSaleSummary = async (vehicleId) => {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: {
      expenses: true,
      payables: {
        include: {
          payments: {
            include: {
              transaction: {
                select: { id: true, date: true, amount: true, type: true, account: { select: { name: true } } }
              }
            }
          },
          thirdParty: { select: { id: true, name: true } }
        }
      }
    }
  });

  if (!vehicle) {
    throw new AppError('Vehículo no encontrado', 404);
  }

  const purchasePayable = vehicle.payables.find(p => p.type === 'PAYABLE');
  const saleReceivable = vehicle.payables.find(p => p.type === 'RECEIVABLE');

  // Calcular totales
  const totalExpenses = vehicle.expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
  const purchasePrice = parseFloat(vehicle.purchasePrice || 0);
  const salePrice = parseFloat(vehicle.salePrice || 0);
  const grossProfit = salePrice - purchasePrice - totalExpenses;

  // Si hubo cruce
  const tradeInValue = parseFloat(vehicle.receivedVehicleValue || 0);

  return {
    vehicle: {
      id: vehicle.id,
      plate: vehicle.plate,
      stage: vehicle.stage
    },
    financials: {
      purchasePrice,
      totalExpenses,
      salePrice,
      grossProfit,
      tradeInValue
    },
    purchase: purchasePayable ? {
      status: purchasePayable.status,
      totalAmount: parseFloat(purchasePayable.totalAmount),
      paidAmount: parseFloat(purchasePayable.paidAmount),
      pendingAmount: parseFloat(purchasePayable.totalAmount) - parseFloat(purchasePayable.paidAmount),
      payments: purchasePayable.payments
    } : null,
    sale: saleReceivable ? {
      status: saleReceivable.status,
      totalAmount: parseFloat(saleReceivable.totalAmount),
      paidAmount: parseFloat(saleReceivable.paidAmount),
      pendingAmount: parseFloat(saleReceivable.totalAmount) - parseFloat(saleReceivable.paidAmount),
      payments: saleReceivable.payments,
      thirdParty: saleReceivable.thirdParty
    } : null,
    tradeIn: vehicle.receivedVehicle ? {
      plate: vehicle.receivedVehiclePlate,
      value: tradeInValue
    } : null
  };
};

/**
 * Cancelar venta (revertir a estado anterior)
 * Solo si no hay transacciones asociadas
 */
const cancelSale = async (vehicleId, userId) => {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: { payables: true }
  });

  if (!vehicle) {
    throw new AppError('Vehículo no encontrado', 404);
  }

  if (vehicle.stage !== 'VENDIDO') {
    throw new AppError('Este vehículo no está marcado como vendido', 400);
  }

  // Verificar si hay CxC con pagos
  const saleReceivable = vehicle.payables.find(p => p.type === 'RECEIVABLE');
  if (saleReceivable && parseFloat(saleReceivable.paidAmount) > 0) {
    throw new AppError('No se puede cancelar la venta porque ya hay cobros registrados', 400);
  }

  // Verificar si hay transacciones de venta
  const saleTransactions = await prisma.transaction.findMany({
    where: {
      vehicleId,
      category: { in: ['VEHICLE_SALE', 'VEHICLE_SALE_PARTIAL'] }
    }
  });

  if (saleTransactions.length > 0) {
    throw new AppError('No se puede cancelar la venta porque ya hay transacciones registradas', 400);
  }

  // Revertir venta
  const result = await prisma.$transaction(async (tx) => {
    // Eliminar CxC si existe
    if (saleReceivable) {
      await tx.payable.delete({ where: { id: saleReceivable.id } });
    }

    // Actualizar vehículo
    const updatedVehicle = await tx.vehicle.update({
      where: { id: vehicleId },
      data: {
        stage: 'DISPONIBLE',
        salePrice: null,
        saleDate: null,
        receivedVehicle: false,
        receivedVehiclePlate: null,
        receivedVehicleValue: null
      }
    });

    return updatedVehicle;
  });

  return result;
};

module.exports = {
  registerSale,
  addSaleCollection,
  getSaleSummary,
  cancelSale
};
