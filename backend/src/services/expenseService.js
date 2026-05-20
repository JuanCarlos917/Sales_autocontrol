// ═══════════════════════════════════════════════════════════════
// Service — Expense (Control de gastos)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

const RESTORE_WINDOW_MS = 5 * 60 * 1000;
const SNAPSHOT_FIELDS = [
  'id', 'vehicleId', 'accountId', 'category', 'amount',
  'description', 'notes', 'date', 'paid',
];
const EDITABLE_FIELDS = [
  'accountId', 'category', 'amount', 'description', 'notes', 'date',
];

function snapshot(expense) {
  return SNAPSHOT_FIELDS.reduce((acc, f) => {
    const v = expense[f];
    acc[f] = v instanceof Date ? v.toISOString() : (v?.toString?.() ?? v);
    return acc;
  }, {});
}

async function writeAudit(tx, { expenseId, userId, action, before, after, reason }) {
  const data = { expenseId, userId, action };
  if (before !== undefined && before !== null) data.before = before;
  if (after !== undefined && after !== null) data.after = after;
  if (reason) data.reason = reason;
  return tx.expenseAuditLog.create({ data });
}

async function assertVehicleEditable(tx, vehicleId) {
  const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { stage: true } });
  if (!vehicle) throw new AppError('Vehículo no encontrado', 404);
  if (vehicle.stage === 'VENDIDO') {
    throw new AppError('Vehículo VENDIDO: no se permiten cambios en gastos', 403);
  }
}

class ExpenseService {
  async findByVehicle(vehicleId, userId, { includeDeleted = false } = {}) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
    if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

    return prisma.expense.findMany({
      where: { vehicleId, ...(includeDeleted ? {} : { deletedAt: null }) },
      orderBy: { date: 'desc' },
    });
  }

  async findAll(userId, { category, paid, includeDeleted = false } = {}) {
    const where = { vehicle: { userId } };
    if (category) where.category = category;
    if (paid !== undefined) where.paid = paid;
    if (!includeDeleted) where.deletedAt = null;

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
      await assertVehicleEditable(tx, expenseData.vehicleId);

      const expense = await tx.expense.create({
        data: {
          ...expenseData,
          accountId,
          paid: !!isPaid,
          createdBy: userId,
          updatedBy: userId,
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
            date: new Date(), // fecha de contabilización = instante de registro
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

      await writeAudit(tx, {
        expenseId: expense.id,
        userId,
        action: 'CREATE',
        after: snapshot(expense),
      });

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
          date: new Date(), // fecha de contabilización = instante de registro
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
        data: { paid: isFullyPaid, updatedBy: userId },
      });

      if (isFullyPaid && !expense.paid) {
        await writeAudit(tx, {
          expenseId,
          userId,
          action: 'UPDATE',
          before: snapshot(expense),
          after: snapshot(updatedExpense),
          reason: 'Pago registrado',
        });
      }

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
      deletedAt: null,
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

  /**
   * Actualiza un gasto siguiendo la policy de campos editables.
   * Campos financieros (amount/accountId/date) generan ajustes en tesorería.
   * Bloqueado si vehículo VENDIDO o si CxP con pagos parciales.
   */
  async update(id, data, userId, { reason } = {}) {
    const expense = await prisma.expense.findFirst({
      where: { id, deletedAt: null },
      include: {
        vehicle: { select: { userId: true, plate: true } },
        payable: true,
      },
    });
    if (!expense || expense.vehicle.userId !== userId) throw new AppError('Gasto no encontrado', 404);

    if (data.vehicleId && data.vehicleId !== expense.vehicleId) {
      throw new AppError('No se puede cambiar el vehículo de un gasto', 400);
    }

    const changes = {};
    for (const f of EDITABLE_FIELDS) {
      if (data[f] === undefined) continue;
      const oldV = expense[f];
      const newV = data[f];
      const same = oldV instanceof Date
        ? new Date(newV).getTime() === oldV.getTime()
        : oldV?.toString?.() === newV?.toString?.();
      if (!same) changes[f] = newV;
    }

    if (Object.keys(changes).length === 0) return expense;

    const isPaidNow = expense.paid;
    const payable = expense.payable;
    const hasPartialPayments = payable && parseFloat(payable.paidAmount) > 0;

    const touchesFinancials =
      changes.amount !== undefined ||
      changes.accountId !== undefined ||
      changes.date !== undefined;

    if (hasPartialPayments && (changes.amount !== undefined || changes.accountId !== undefined)) {
      throw new AppError('No se puede modificar monto ni cuenta de un gasto con pagos parciales registrados', 400);
    }

    const before = snapshot(expense);

    const result = await prisma.$transaction(async (tx) => {
      await assertVehicleEditable(tx, expense.vehicleId);

      const updated = await tx.expense.update({
        where: { id },
        data: { ...changes, updatedBy: userId },
      });

      const oldAmount = parseFloat(expense.amount);
      const newAmount = changes.amount !== undefined ? parseFloat(changes.amount) : oldAmount;
      const accountChanged = changes.accountId !== undefined && changes.accountId !== expense.accountId;
      const amountChanged = changes.amount !== undefined && newAmount !== oldAmount;
      const dateChanged = changes.date !== undefined;

      // Caso CxP sin pagos: ajustamos Payable.totalAmount sin tocar tesorería
      if (payable && !isPaidNow) {
        if (amountChanged) {
          await tx.payable.update({ where: { id: payable.id }, data: { totalAmount: newAmount } });
        }
      }

      // Caso pagado: generar Transactions de ajuste
      if (isPaidNow && touchesFinancials) {
        if (accountChanged) {
          // Reverso completo en cuenta vieja + cargo completo en cuenta nueva
          await tx.transaction.create({
            data: {
              accountId: expense.accountId,
              type: 'INCOME',
              category: 'EXPENSE_ADJUSTMENT',
              amount: newAmount,
              description: `Ajuste por cambio de cuenta (reverso): ${expense.description || expense.category}`,
              date: new Date(),
              vehicleId: expense.vehicleId,
              expenseId: expense.id,
              createdBy: userId,
            },
          });
          await tx.transaction.create({
            data: {
              accountId: changes.accountId,
              type: 'EXPENSE',
              category: 'EXPENSE_ADJUSTMENT',
              amount: newAmount,
              description: `Ajuste por cambio de cuenta (cargo): ${expense.description || expense.category}`,
              date: new Date(),
              vehicleId: expense.vehicleId,
              expenseId: expense.id,
              createdBy: userId,
            },
          });
        } else if (amountChanged) {
          const delta = newAmount - oldAmount;
          await tx.transaction.create({
            data: {
              accountId: expense.accountId,
              type: delta > 0 ? 'EXPENSE' : 'INCOME',
              category: 'EXPENSE_ADJUSTMENT',
              amount: Math.abs(delta),
              description: `Ajuste de monto: ${expense.description || expense.category}`,
              date: new Date(),
              vehicleId: expense.vehicleId,
              expenseId: expense.id,
              createdBy: userId,
            },
          });
        }

        if (dateChanged && !accountChanged) {
          // Actualiza la fecha de la Transaction original (la primera no-reversa/no-ajuste)
          const original = await tx.transaction.findFirst({
            where: { expenseId: expense.id, category: 'VEHICLE_EXPENSE' },
            orderBy: { createdAt: 'asc' },
          });
          if (original) {
            await tx.transaction.update({ where: { id: original.id }, data: { date: new Date(changes.date) } });
          }
        }
      }

      await writeAudit(tx, {
        expenseId: id,
        userId,
        action: 'UPDATE',
        before,
        after: snapshot(updated),
        reason,
      });

      return updated;
    });

    return result;
  }

  /**
   * Soft delete: marca deletedAt, crea reversos en tesorería y cancela payable si existe.
   * Requiere motivo (mínimo 10 caracteres).
   */
  async delete(id, userId, { reason } = {}) {
    if (!reason || reason.trim().length < 10) {
      throw new AppError('Debe indicar un motivo de al menos 10 caracteres para eliminar', 400);
    }

    const expense = await prisma.expense.findFirst({
      where: { id, deletedAt: null },
      include: {
        vehicle: { select: { userId: true } },
        payable: { include: { payments: true } },
        transactions: true,
      },
    });
    if (!expense || expense.vehicle.userId !== userId) throw new AppError('Gasto no encontrado', 404);

    const before = snapshot(expense);

    await prisma.$transaction(async (tx) => {
      await assertVehicleEditable(tx, expense.vehicleId);

      // Crear reverso para cada Transaction no-reversal vinculada al gasto
      const toReverse = expense.transactions.filter((t) => t.category !== 'EXPENSE_REVERSAL');
      for (const t of toReverse) {
        const oppositeType = t.type === 'EXPENSE' ? 'INCOME' : 'EXPENSE';
        await tx.transaction.create({
          data: {
            accountId: t.accountId,
            type: oppositeType,
            category: 'EXPENSE_REVERSAL',
            amount: t.amount,
            description: `Reverso por borrado: ${t.description || expense.category}`,
            date: new Date(),
            vehicleId: t.vehicleId,
            expenseId: expense.id,
            thirdPartyId: t.thirdPartyId,
            createdBy: userId,
          },
        });
      }

      if (expense.payable && expense.payable.status !== 'CANCELLED') {
        await tx.payable.update({
          where: { id: expense.payable.id },
          data: { status: 'CANCELLED' },
        });
      }

      const deleted = await tx.expense.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: userId },
      });

      await writeAudit(tx, {
        expenseId: id,
        userId,
        action: 'DELETE',
        before,
        reason,
      });

      return deleted;
    });

    return { deleted: true };
  }

  /**
   * Restaura un gasto soft-deleted dentro de la ventana de 5 minutos.
   * Borra los reversos creados durante el delete y des-cancela el Payable.
   */
  async restore(id, userId) {
    const expense = await prisma.expense.findFirst({
      where: { id },
      include: {
        vehicle: { select: { userId: true } },
        payable: true,
      },
    });
    if (!expense || expense.vehicle.userId !== userId) throw new AppError('Gasto no encontrado', 404);
    if (!expense.deletedAt) throw new AppError('El gasto no está eliminado', 400);

    const elapsedMs = Date.now() - new Date(expense.deletedAt).getTime();
    if (elapsedMs > RESTORE_WINDOW_MS) {
      throw new AppError('La ventana de 5 minutos para deshacer ha expirado', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      await assertVehicleEditable(tx, expense.vehicleId);

      // Borrar todos los reversos del gasto: en estado restaurado no debe quedar ninguno.
      // Si hubo soft-delete previo, los reversos de ese ciclo ya fueron eliminados en su propio restore.
      await tx.transaction.deleteMany({
        where: { expenseId: id, category: 'EXPENSE_REVERSAL' },
      });

      // Des-cancelar el payable: derivar estado a partir de paidAmount
      if (expense.payable && expense.payable.status === 'CANCELLED') {
        const paid = parseFloat(expense.payable.paidAmount);
        const total = parseFloat(expense.payable.totalAmount);
        const newStatus = paid === 0 ? 'PENDING' : (paid >= total ? 'PAID' : 'PARTIAL');
        await tx.payable.update({ where: { id: expense.payable.id }, data: { status: newStatus } });
      }

      const restored = await tx.expense.update({
        where: { id },
        data: { deletedAt: null, deletedBy: null },
      });

      await writeAudit(tx, {
        expenseId: id,
        userId,
        action: 'RESTORE',
        after: snapshot(restored),
      });

      return restored;
    });

    return result;
  }

  /**
   * Devuelve el audit log de un gasto (orden cronológico DESC).
   */
  async getAuditLog(id, userId) {
    const expense = await prisma.expense.findFirst({
      where: { id },
      include: { vehicle: { select: { userId: true } } },
    });
    if (!expense || expense.vehicle.userId !== userId) throw new AppError('Gasto no encontrado', 404);

    return prisma.expenseAuditLog.findMany({
      where: { expenseId: id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}

module.exports = new ExpenseService();
