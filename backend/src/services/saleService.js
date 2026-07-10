// ═══════════════════════════════════════════════════════════════
// Sale Service — Flujo de venta de vehículos con tesorería
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const commissionService = require('./commissionService');
const { calculateCommissionBase } = require('../utils/financial');

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
    cashPayments,
    tradeIn,
    financing,
    buyerId,
    thirdPartyId, // Deprecated, usar buyerId
    saleDate
  } = saleData;

  // Usar buyerId si está presente, sino fallback a thirdPartyId
  const clientId = buyerId || thirdPartyId;

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

  // Guard de sobre-recibido (auditoría 🟠 #7): lo recibido (efectivo/transferencia
  // + cruce) no puede superar el precio de venta — el excedente entraría a caja
  // sin respaldo contable.
  const intendedPayments = (Array.isArray(cashPayments) && cashPayments.length > 0)
    ? cashPayments
    : (cashPayment ? [cashPayment] : []);
  const intendedCash = intendedPayments.reduce(
    (s, p) => (p?.accountId && parseFloat(p.amount) > 0 ? s + parseFloat(p.amount) : s),
    0,
  );
  const intendedTradeIn = tradeIn?.value ? parseFloat(tradeIn.value) : 0;
  if (intendedCash + intendedTradeIn > salePriceNum + 0.001) {
    throw new AppError(
      `Lo recibido (${intendedCash + intendedTradeIn}) supera el precio de venta (${salePriceNum})`,
      400,
    );
  }

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
        buyerId: clientId || null,
        // Si hay cruce, guardar datos
        receivedVehicle: tradeIn ? true : false,
        receivedVehiclePlate: tradeIn?.plate || null,
        receivedVehicleValue: tradeIn?.value || null
      },
      include: { expenses: true, documents: true, buyer: true }
    });

    // 2. Procesar pago(s) en efectivo/transferencia (una o varias líneas)
    const methodLabel = { CASH: ' (efectivo)', TRANSFER: ' (transferencia)' };
    const moneyPayments = (Array.isArray(cashPayments) && cashPayments.length > 0)
      ? cashPayments
      : (cashPayment ? [cashPayment] : []);

    for (const pay of moneyPayments) {
      if (!pay?.accountId || !(parseFloat(pay.amount) > 0)) continue;
      const amount = parseFloat(pay.amount);
      totalReceived += amount;
      pendingAmount -= amount;

      const transaction = await tx.transaction.create({
        data: {
          accountId: pay.accountId,
          type: 'INCOME',
          category: 'VEHICLE_SALE',
          amount,
          description: `Venta vehículo ${vehicle.plate}${methodLabel[pay.method] || ''}`,
          date: new Date(), // fecha de contabilización = instante de registro
          vehicleId: vehicleId,
          thirdPartyId: clientId || null,
          createdBy: userId
        }
      });
      transactions.push(transaction);
    }

    // 3. Procesar cruce de vehículo: el recibido entra a NEGOCIANDO con el valor del
    //    cruce como valor negociado (inmutable). La compra se difiere: no se registra
    //    CxP todavía; al avanzar a COMPRADO se salda automáticamente por el cruce.
    //
    //    El comprador de la venta queda registrado como proveedor del cruce
    //    (es quien lo entregó como parte de pago), y sourceVehicleId apunta a la
    //    venta de origen para trazabilidad bidireccional. Si el comprador era CLIENT,
    //    se auto-upgrade a BOTH para que figure válidamente como proveedor.
    if (tradeIn?.plate && tradeIn?.value > 0) {
      const tradeInValue = parseFloat(tradeIn.value);
      totalReceived += tradeInValue;
      pendingAmount -= tradeInValue;

      if (clientId) {
        const buyerThirdParty = await tx.thirdParty.findUnique({
          where: { id: clientId },
          select: { id: true, type: true }
        });
        if (buyerThirdParty?.type === 'CLIENT') {
          await tx.thirdParty.update({
            where: { id: clientId },
            data: { type: 'BOTH' }
          });
        }
      }

      newVehicle = await tx.vehicle.create({
        data: {
          plate: tradeIn.plate,
          brand: tradeIn.brand || null,
          model: tradeIn.model || null,
          year: tradeIn.year || null,
          color: tradeIn.color || null,
          km: tradeIn.km || null,
          stage: 'NEGOCIANDO',
          negotiatedValue: tradeInValue,
          fromTradeIn: true,
          sourceVehicleId: vehicleId,
          supplierId: clientId || null,
          notes: `Recibido en cruce por venta de ${vehicle.plate}`,
          userId: vehicle.userId
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
          thirdPartyId: clientId || null,
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

    // ─── Paso 5: Comisiones y bolsillos ─────────────────────────────
    // Calcula la base, resuelve participantes, crea CxP COMMISSION por
    // participante y Transfers proporcionales al efectivo recibido.
    let commissionSummary = null;
    const vehicleForBase = {
      salePrice: salePriceNum,
      purchasePrice: vehicle.purchasePrice,
      negotiatedValue: vehicle.negotiatedValue,
      fromTradeIn: vehicle.fromTradeIn,
      participation: vehicle.participation,
      expenses: vehicle.expenses,
    };
    const { commissionBase, skip } = calculateCommissionBase(vehicleForBase);

    if (!skip) {
      const cfg = await commissionService.loadCommissionConfig(tx);
      const pools = commissionService.calculatePools(commissionBase, cfg);
      const resolved = await commissionService.resolveParticipants(tx, saleData.participants, cfg);

      // 5a. Crear SaleParticipant + Payable COMMISSION por cada uno
      const participantResults = [];
      for (const p of resolved) {
        const amount = pools.commissionPool * (p.sharePct / 100);
        const payable = await tx.payable.create({
          data: {
            type: 'COMMISSION',
            status: 'PENDING',
            totalAmount: amount,
            paidAmount: 0,
            description: `Comisión venta ${vehicle.plate} — ${p.role}`,
            vehicleId,
            thirdPartyId: p.thirdPartyId,
            createdBy: userId,
          },
        });
        const sp = await tx.saleParticipant.create({
          data: {
            vehicleId,
            thirdPartyId: p.thirdPartyId,
            role: p.role,
            sharePct: p.sharePct,
            amount,
            payableId: payable.id,
          },
        });
        participantResults.push({
          id: sp.id,
          thirdPartyId: p.thirdPartyId,
          role: p.role,
          sharePct: p.sharePct,
          amount,
          payableId: payable.id,
        });
      }

      // 5b. Transfers proporcionales al efectivo recibido.
      //
      // El patrón estándar del proyecto (transferService.create) crea 1 Transfer
      // + 2 Transactions (TRANSFER_OUT en origen, TRANSFER_IN en destino).
      // Ambas transactions son indispensables para que accountService.calculateBalance
      // las sume al saldo de las cuentas; sin ellas las cuentas BUDGET quedan con
      // saldo 0 aunque el Transfer exista.
      const tradeInValueNum = tradeIn?.value ? parseFloat(tradeIn.value) : 0;
      const cashReceived = totalReceived - tradeInValueNum;
      const cashRatio = commissionService.calculateCashRatio(totalReceived, cashReceived);
      const transferResults = [];

      const createBucketTransfer = async (toAccountId, amount, descriptionLabel) => {
        const transfer = await tx.transfer.create({
          data: {
            fromAccountId: moneyPayments[0].accountId,
            toAccountId,
            amount,
            description: `${descriptionLabel} venta ${vehicle.plate}`,
            date: new Date(),
            createdBy: userId,
          },
        });
        await tx.transaction.create({
          data: {
            accountId: moneyPayments[0].accountId,
            type: 'TRANSFER_OUT',
            category: 'TRANSFER',
            amount,
            description: `${descriptionLabel} venta ${vehicle.plate}`,
            date: new Date(),
            vehicleId,
            transferId: transfer.id,
            createdBy: userId,
          },
        });
        await tx.transaction.create({
          data: {
            accountId: toAccountId,
            type: 'TRANSFER_IN',
            category: 'TRANSFER',
            amount,
            description: `${descriptionLabel} venta ${vehicle.plate}`,
            date: new Date(),
            vehicleId,
            transferId: transfer.id,
            createdBy: userId,
          },
        });
        return transfer;
      };

      if (cashReceived > 0 && moneyPayments.length > 0) {
        const reinvestAmt = pools.reinvestPool * cashRatio;
        const taxAmt = pools.taxPool * cashRatio;
        if (reinvestAmt > 0) {
          const t = await createBucketTransfer(cfg.reinvestAccountId, reinvestAmt, 'Reinversión');
          transferResults.push({
            id: t.id,
            fromAccountId: moneyPayments[0].accountId,
            toAccountId: cfg.reinvestAccountId,
            amount: Number(t.amount),
            description: t.description,
          });
        }
        if (taxAmt > 0) {
          const t = await createBucketTransfer(cfg.taxReserveAccountId, taxAmt, 'Impuestos');
          transferResults.push({
            id: t.id,
            fromAccountId: moneyPayments[0].accountId,
            toAccountId: cfg.taxReserveAccountId,
            amount: Number(t.amount),
            description: t.description,
          });
        }
      }

      commissionSummary = {
        commissionBase,
        commissionPool: pools.commissionPool,
        reinvestPool: pools.reinvestPool,
        taxPool: pools.taxPool,
        cashRatioApplied: cashRatio,
        participants: participantResults,
        transfers: transferResults,
      };
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
        tradeInValue: tradeIn?.value || 0,
        ...(commissionSummary || {}),
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
        date: new Date(), // fecha de contabilización = instante de registro
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

  // Verificar si hay Payables COMMISSION asociadas
  const commissionPayables = await prisma.payable.findMany({
    where: { vehicleId, type: 'COMMISSION' },
  });
  if (commissionPayables.length > 0) {
    throw new AppError(
      'No se puede cancelar la venta porque hay comisiones devengadas. ' +
      'Anula o paga las CxP de comisión primero.',
      400
    );
  }

  // Verificar si hay Transfers asociadas a cuentas BUDGET (reinversión / impuestos)
  const cfg = await prisma.setting.findMany({
    where: { key: { in: ['reinvest_account_id', 'tax_reserve_account_id'] } },
  });
  const budgetAccountIds = cfg.map(s => s.value).filter(Boolean);
  if (budgetAccountIds.length > 0) {
    const budgetTransfers = await prisma.transfer.findMany({
      where: {
        toAccountId: { in: budgetAccountIds },
        description: { contains: vehicle.plate },
      },
    });
    if (budgetTransfers.length > 0) {
      throw new AppError(
        'No se puede cancelar la venta porque hay transferencias a fondos de reinversión / impuestos. ' +
        'Reversa esas transferencias primero.',
        400
      );
    }
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
