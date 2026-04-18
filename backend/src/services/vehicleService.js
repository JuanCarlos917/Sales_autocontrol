// ═══════════════════════════════════════════════════════════════
// Service — Vehicle (CRUD + lógica de negocio)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculateVehicleMetrics } = require('../utils/financial');

const VEHICLE_INCLUDE = {
  expenses: { orderBy: { createdAt: 'desc' } },
  documents: { orderBy: { createdAt: 'desc' } },
};

class VehicleService {
  async findAll(userId, { stage, search } = {}) {
    const where = { userId };
    if (stage) where.stage = stage;
    if (search) {
      where.OR = [
        { plate: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
      ];
    }

    const vehicles = await prisma.vehicle.findMany({
      where,
      include: VEHICLE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    // Obtener gasto fijo mensual de settings
    const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });
    const fixedMonthly = fixedSetting ? parseFloat(fixedSetting.value) : 800000;

    return vehicles.map(v => ({
      ...v,
      metrics: calculateVehicleMetrics(v, fixedMonthly),
    }));
  }

  async findById(id, userId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id, userId },
      include: VEHICLE_INCLUDE,
    });

    if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

    const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });
    const fixedMonthly = fixedSetting ? parseFloat(fixedSetting.value) : 800000;

    return { ...vehicle, metrics: calculateVehicleMetrics(vehicle, fixedMonthly) };
  }

  async create(data, userId) {
    const vehicle = await prisma.vehicle.create({
      data: { ...data, userId },
      include: VEHICLE_INCLUDE,
    });
    return vehicle;
  }

  async update(id, data, userId) {
    // Verificar propiedad
    const existing = await prisma.vehicle.findFirst({ where: { id, userId } });
    if (!existing) throw new AppError('Vehículo no encontrado', 404);

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data,
      include: VEHICLE_INCLUDE,
    });
    return vehicle;
  }

  async updateStage(id, stage, userId) {
    const existing = await prisma.vehicle.findFirst({ where: { id, userId } });
    if (!existing) throw new AppError('Vehículo no encontrado', 404);

    const updateData = { stage };

    // Auto-fill dates on stage change
    if (stage === 'COMPRADO' && !existing.purchaseDate) {
      updateData.purchaseDate = new Date();
    }
    if (stage === 'VENDIDO' && !existing.saleDate) {
      updateData.saleDate = new Date();
    }

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: updateData,
      include: VEHICLE_INCLUDE,
    });

    // Auto-crear transacción de ingreso al vender
    if (stage === 'VENDIDO' && existing.stage !== 'VENDIDO' && vehicle.salePrice) {
      const cashAccount = await prisma.account.findFirst({
        where: { type: 'CASH', isActive: true },
      });

      if (cashAccount) {
        await prisma.transaction.create({
          data: {
            accountId: cashAccount.id,
            type: 'INCOME',
            category: 'VEHICLE_SALE',
            amount: vehicle.salePrice,
            description: `Venta de vehículo ${vehicle.plate}`,
            vehicleId: vehicle.id,
            createdBy: userId,
          },
        });
      }
    }

    return vehicle;
  }

  async delete(id, userId) {
    const existing = await prisma.vehicle.findFirst({ where: { id, userId } });
    if (!existing) throw new AppError('Vehículo no encontrado', 404);

    // Cascade delete handles expenses and documents
    await prisma.vehicle.delete({ where: { id } });
    return { deleted: true };
  }
}

module.exports = new VehicleService();
