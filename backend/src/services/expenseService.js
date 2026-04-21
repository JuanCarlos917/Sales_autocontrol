// ═══════════════════════════════════════════════════════════════
// Service — Expense (Control de gastos)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

class ExpenseService {
  async findByVehicle(vehicleId, userId) {
    // Verify vehicle ownership
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
    if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

    return prisma.expense.findMany({
      where: { vehicleId },
      orderBy: { date: 'desc' },
    });
  }

  async findAll(userId, { category, paid } = {}) {
    const where = { vehicle: { userId } };
    if (category) where.category = category;
    if (paid !== undefined) where.paid = paid;

    return prisma.expense.findMany({
      where,
      include: { vehicle: { select: { id: true, plate: true, brand: true, model: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Crea un gasto con integración obligatoria de tesorería.
   * Todos los gastos deben estar asociados a una cuenta y descontar de tesorería
   * (pagados) o registrarse como CxP pendiente.
   *
   * @param {Object} data - Datos del gasto
   * @param {string} data.accountId - Cuenta asociada (siempre obligatoria)
   * @param {boolean} data.isPaid - Si el gasto ya está pagado (default: true)
   * @param {string} data.thirdPartyId - Tercero/proveedor (opcional)
   * @param {Date} data.dueDate - Fecha de vencimiento si no está pagado
   * @param {string} userId - ID del usuario
   */
  async createWithTreasury(data, userId) {
    const { accountId, isPaid = true, thirdPartyId, dueDate, ...expenseData } = data;

    if (!accountId) {
      throw new AppError('Debe seleccionar una cuenta de tesorería para registrar el gasto', 400);
    }

    // Verify vehicle ownership
    const vehicle = await prisma.vehicle.findFirst({ where: { id: expenseData.vehicleId, userId } });
    if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

    // Validar que la cuenta exista y esté activa
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || !account.isActive) {
      throw new AppError('La cuenta seleccionada no existe o está inactiva', 400);
    }

    let warning = null;

    // Verificar saldo solo si está pagado (warning only, no bloquear)
    if (isPaid) {
      const accountService = require('./accountService');
      const currentBalance = await accountService.calculateBalance(accountId);

      if (currentBalance < expenseData.amount) {
        warning = {
          type: 'NEGATIVE_BALANCE',
          message: `La cuenta "${account.name}" quedará con saldo negativo`,
          currentBalance,
          newBalance: currentBalance - expenseData.amount
        };
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          ...expenseData,
          accountId,
          paid: !!isPaid,
        }
      });

      let transaction = null;
      let payable = null;

      if (isPaid) {
        transaction = await tx.transaction.create({
          data: {
            accountId,
            type: 'EXPENSE',
            category: 'VEHICLE_EXPENSE',
            amount: expenseData.amount,
            description: expenseData.description || `Gasto ${expenseData.category} - ${vehicle.plate}`,
            date: expenseData.date || new Date(),
            vehicleId: expenseData.vehicleId,
            expenseId: expense.id,
            thirdPartyId: thirdPartyId || null,
            createdBy: userId,
          },
        });
      } else {
        payable = await tx.payable.create({
          data: {
            type: 'PAYABLE',
            status: 'PENDING',
            totalAmount: expenseData.amount,
            paidAmount: 0,
            dueDate: dueDate ? new Date(dueDate) : null,
            description: expenseData.description || `Gasto ${expenseData.category} - ${vehicle.plate}`,
            vehicleId: expenseData.vehicleId,
            expenseId: expense.id,
            thirdPartyId: thirdPartyId || null,
            createdBy: userId,
          },
        });
      }

      return { expense, transaction, payable };
    });

    return { ...result, warning };
  }

  /**
   * Registra el pago de un gasto existente (pago total o parcial)
   * @param {string} expenseId - ID del gasto
   * @param {Object} paymentData - Datos del pago
   * @param {string} paymentData.accountId - Cuenta de pago
   * @param {number} paymentData.amount - Monto a pagar (opcional, default: total pendiente)
   * @param {Date} paymentData.date - Fecha del pago
   * @param {string} userId - ID del usuario
   */
  async payExpense(expenseId, paymentData, userId) {
    const { accountId, amount, date } = paymentData;

    const expense = await prisma.expense.findFirst({
      where: { id: expenseId },
      include: {
        vehicle: { select: { userId: true, plate: true } },
        payable: {
          include: {
            payments: true
          }
        }
      },
    });

    if (!expense || expense.vehicle.userId !== userId) throw new AppError('Gasto no encontrado', 404);
    if (expense.paid) throw new AppError('Este gasto ya está pagado', 400);

    const expenseAmount = parseFloat(expense.amount);
    const payable = expense.payable;

    // Calcular monto pendiente
    let pendingAmount = expenseAmount;
    if (payable) {
      pendingAmount = expenseAmount - parseFloat(payable.paidAmount);
    }

    const paymentAmount = amount ? parseFloat(amount) : pendingAmount;

    if (paymentAmount > pendingAmount) {
      throw new AppError(`El monto excede el saldo pendiente de ${pendingAmount}`, 400);
    }

    // Verificar saldo (warning only)
    let warning = null;
    const accountService = require('./accountService');
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    const currentBalance = await accountService.calculateBalance(accountId);

    if (currentBalance < paymentAmount) {
      warning = {
        type: 'NEGATIVE_BALANCE',
        message: `La cuenta "${account?.name}" quedará con saldo negativo`,
        currentBalance,
        newBalance: currentBalance - paymentAmount
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Crear transacción de egreso
      const transaction = await tx.transaction.create({
        data: {
          accountId,
          type: 'EXPENSE',
          category: 'VEHICLE_EXPENSE',
          amount: paymentAmount,
          description: expense.description || `Gasto ${expense.category} - ${expense.vehicle.plate}`,
          date: date ? new Date(date) : new Date(),
          vehicleId: expense.vehicleId,
          expenseId: expense.id,
          thirdPartyId: payable?.thirdPartyId || null,
          createdBy: userId,
        },
      });

      let updatedPayable = null;

      // 2. Si hay CxP asociada, actualizarla
      if (payable) {
        const newPaidAmount = parseFloat(payable.paidAmount) + paymentAmount;
        const isFullyPaid = newPaidAmount >= expenseAmount;

        // Crear PayablePayment
        await tx.payablePayment.create({
          data: {
            payableId: payable.id,
            transactionId: transaction.id,
            amount: paymentAmount
          }
        });

        // Actualizar Payable
        updatedPayable = await tx.payable.update({
          where: { id: payable.id },
          data: {
            paidAmount: newPaidAmount,
            status: isFullyPaid ? 'PAID' : 'PARTIAL'
          }
        });
      }

      // 3. Actualizar gasto como pagado si se pagó todo
      const totalPaid = payable
        ? parseFloat(payable.paidAmount) + paymentAmount
        : paymentAmount;
      const isFullyPaid = totalPaid >= expenseAmount;

      const updatedExpense = await tx.expense.update({
        where: { id: expenseId },
        data: { paid: isFullyPaid },
      });

      return { expense: updatedExpense, transaction, payable: updatedPayable };
    });

    return { ...result, warning };
  }

  /**
   * Obtener estado de pago de un gasto
   */
  async getPaymentStatus(expenseId, userId) {
    const expense = await prisma.expense.findFirst({
      where: { id: expenseId },
      include: {
        vehicle: { select: { userId: true, plate: true } },
        payable: {
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
          }
        }
      },
    });

    if (!expense || expense.vehicle.userId !== userId) throw new AppError('Gasto no encontrado', 404);

    const totalAmount = parseFloat(expense.amount);
    const paidAmount = expense.payable ? parseFloat(expense.payable.paidAmount) : (expense.paid ? totalAmount : 0);

    return {
      expense: {
        id: expense.id,
        category: expense.category,
        description: expense.description,
        amount: totalAmount,
        paid: expense.paid,
        vehiclePlate: expense.vehicle.plate
      },
      payable: expense.payable ? {
        id: expense.payable.id,
        status: expense.payable.status,
        dueDate: expense.payable.dueDate,
        thirdParty: expense.payable.thirdParty,
        payments: expense.payable.payments
      } : null,
      summary: {
        totalAmount,
        paidAmount,
        pendingAmount: totalAmount - paidAmount
      }
    };
  }

  /**
   * Obtener gastos pendientes de pago
   */
  async getUnpaidExpenses(userId, vehicleId = null) {
    const where = {
      paid: false,
      vehicle: { userId }
    };

    if (vehicleId) {
      where.vehicleId = vehicleId;
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        vehicle: { select: { id: true, plate: true, brand: true, model: true } },
        payable: {
          select: {
            id: true,
            status: true,
            dueDate: true,
            paidAmount: true,
            thirdParty: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: [
        { payable: { dueDate: 'asc' } },
        { createdAt: 'desc' }
      ]
    });

    return expenses.map(e => ({
      ...e,
      pendingAmount: parseFloat(e.amount) - (e.payable ? parseFloat(e.payable.paidAmount) : 0)
    }));
  }

  async update(id, data, userId) {
    const expense = await prisma.expense.findFirst({
      where: { id },
      include: { vehicle: { select: { userId: true } } },
    });
    if (!expense || expense.vehicle.userId !== userId) throw new AppError('Gasto no encontrado', 404);

    return prisma.expense.update({ where: { id }, data });
  }

  async delete(id, userId) {
    const expense = await prisma.expense.findFirst({
      where: { id },
      include: {
        vehicle: { select: { userId: true } },
        payable: { include: { payments: true } },
      },
    });
    if (!expense || expense.vehicle.userId !== userId) throw new AppError('Gasto no encontrado', 404);

    await prisma.$transaction(async (tx) => {
      // Limpiar pagos y payable asociados (reversan saldo a través de las transacciones vinculadas)
      if (expense.payable) {
        const paymentTxIds = expense.payable.payments.map(p => p.transactionId);
        await tx.payablePayment.deleteMany({ where: { payableId: expense.payable.id } });
        if (paymentTxIds.length > 0) {
          await tx.transaction.deleteMany({ where: { id: { in: paymentTxIds } } });
        }
        await tx.payable.delete({ where: { id: expense.payable.id } });
      }

      // Limpiar transacción de egreso directa (gasto pagado al momento)
      await tx.transaction.deleteMany({ where: { expenseId: id } });

      await tx.expense.delete({ where: { id } });
    });

    return { deleted: true };
  }
}

module.exports = new ExpenseService();
