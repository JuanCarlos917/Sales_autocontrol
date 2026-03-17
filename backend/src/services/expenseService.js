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

  async create(data, userId) {
    // Verify vehicle ownership
    const vehicle = await prisma.vehicle.findFirst({ where: { id: data.vehicleId, userId } });
    if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

    return prisma.expense.create({ data });
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
      include: { vehicle: { select: { userId: true } } },
    });
    if (!expense || expense.vehicle.userId !== userId) throw new AppError('Gasto no encontrado', 404);

    await prisma.expense.delete({ where: { id } });
    return { deleted: true };
  }
}

module.exports = new ExpenseService();
