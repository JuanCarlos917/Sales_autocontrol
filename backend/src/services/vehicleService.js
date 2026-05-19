// ═══════════════════════════════════════════════════════════════
// Service — Vehicle (CRUD + lógica de negocio)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculateVehicleMetrics, calculateParticipation } = require('../utils/financial');

// Campos de participación/socio que quedan bloqueados después de NEGOCIANDO
const PARTNER_LOCKED_FIELDS = ['participation', 'partnerContribution', 'partnerId', 'partnerAssumesExpenses', 'purchasePrice'];

const VEHICLE_INCLUDE = {
  expenses: { orderBy: { createdAt: 'desc' } },
  documents: { orderBy: { createdAt: 'desc' } },
  supplier: { select: { id: true, name: true, document: true, phone: true, type: true } },
  partner: { select: { id: true, name: true, document: true, phone: true, type: true } },
  buyer: { select: { id: true, name: true, document: true, phone: true, type: true } },
};

// Etapas que requieren valor negociado/precio de compra (todas menos NEGOCIANDO)
const STAGES_REQUIRING_VALUE = ['COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'];
// Etapas que requieren proveedor obligatorio (después de COMPRADO)
const STAGES_REQUIRING_SUPPLIER = ['ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'];

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
    // Auto-calcular participación a partir del aporte del socio si no viene explícita
    const payload = { ...data };
    if (payload.partnerContribution && payload.purchasePrice && (payload.participation === undefined || payload.participation === null)) {
      payload.participation = calculateParticipation(payload.purchasePrice, payload.partnerContribution);
    }

    const vehicle = await prisma.vehicle.create({
      data: { ...payload, userId },
      include: VEHICLE_INCLUDE,
    });

    // Calcular métricas antes de retornar
    const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });
    const fixedMonthly = fixedSetting ? parseFloat(fixedSetting.value) : 800000;

    return { ...vehicle, metrics: calculateVehicleMetrics(vehicle, fixedMonthly) };
  }

  async update(id, data, userId) {
    // Verificar propiedad
    const existing = await prisma.vehicle.findFirst({ where: { id, userId } });
    if (!existing) throw new AppError('Vehículo no encontrado', 404);

    // Bloquear edición de campos de socio/precio: siempre en ALISTAMIENTO+,
    // y en COMPRADO solo si ya existe la CxP (compra registrada).
    let isFieldLocked = false;
    if (existing.stage !== 'NEGOCIANDO') {
      if (existing.stage === 'COMPRADO') {
        const payable = await prisma.payable.findFirst({
          where: { vehicleId: id, type: 'PAYABLE' },
        });
        isFieldLocked = !!payable;
      } else {
        isFieldLocked = true;
      }
    }

    if (isFieldLocked) {
      const lockedChanged = PARTNER_LOCKED_FIELDS.filter(f => {
        if (!(f in data)) return false;
        const currentVal = existing[f];
        const newVal = data[f];
        // Comparar como string para manejar Decimals
        return String(currentVal ?? '') !== String(newVal ?? '');
      });
      if (lockedChanged.length > 0) {
        throw new AppError(
          `No se pueden modificar los siguientes campos después de registrar la compra: ${lockedChanged.join(', ')}`,
          400
        );
      }
    }

    // Proveedor y socio, una vez asignados, son inmutables en cualquier etapa
    if (existing.supplierId && 'supplierId' in data && data.supplierId !== existing.supplierId) {
      throw new AppError('El proveedor no puede modificarse una vez asignado', 400);
    }
    if (existing.partnerId && 'partnerId' in data && data.partnerId !== existing.partnerId) {
      throw new AppError('El socio no puede modificarse una vez asignado', 400);
    }

    // Auto-recalcular participación si cambia el aporte del socio (mientras no esté bloqueado)
    const payload = { ...data };
    if (!isFieldLocked && 'partnerContribution' in payload) {
      const price = payload.purchasePrice ?? existing.purchasePrice;
      if (price && payload.partnerContribution) {
        payload.participation = calculateParticipation(price, payload.partnerContribution);
      }
    }

    // Bloquear quedarse/pasar a PUBLICADO sin listedPrice
    const resultingStage = payload.stage ?? existing.stage;
    const resultingListedPrice = 'listedPrice' in payload ? payload.listedPrice : existing.listedPrice;
    if (resultingStage === 'PUBLICADO' && !(resultingListedPrice && parseFloat(resultingListedPrice) > 0)) {
      throw new AppError('Debe definir el Precio Publicado antes de pasar a Publicado', 400);
    }

    // Bloquear quedarse/pasar a DISPONIBLE sin salePrice o saleDate
    if (resultingStage === 'DISPONIBLE') {
      const resultingSalePrice = 'salePrice' in payload ? payload.salePrice : existing.salePrice;
      const resultingSaleDate = 'saleDate' in payload ? payload.saleDate : existing.saleDate;
      if (!(resultingSalePrice && parseFloat(resultingSalePrice) > 0)) {
        throw new AppError('Debe definir el Precio de Venta antes de pasar a Disponible', 400);
      }
      if (!resultingSaleDate) {
        throw new AppError('Debe definir la Fecha de Venta antes de pasar a Disponible', 400);
      }
    }

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: payload,
      include: VEHICLE_INCLUDE,
    });

    // Calcular métricas antes de retornar
    const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });
    const fixedMonthly = fixedSetting ? parseFloat(fixedSetting.value) : 800000;

    return { ...vehicle, metrics: calculateVehicleMetrics(vehicle, fixedMonthly) };
  }

  async updateStage(id, stage, userId) {
    const existing = await prisma.vehicle.findFirst({
      where: { id, userId },
      include: VEHICLE_INCLUDE,
    });
    if (!existing) throw new AppError('Vehículo no encontrado', 404);

    // VENDIDO es estado final: no se puede mover a otra etapa
    if (existing.stage === 'VENDIDO' && stage !== 'VENDIDO') {
      throw new AppError('VENDIDO es un estado final: no se puede mover a otra etapa', 403);
    }

    // Desde NEGOCIANDO solo se permite pasar a COMPRADO
    if (existing.stage === 'NEGOCIANDO' && stage !== 'NEGOCIANDO' && stage !== 'COMPRADO') {
      throw new AppError('Desde Negociando solo puedes pasar a Comprado', 400);
    }

    // Desde COMPRADO hacia etapas posteriores: exigir precio de compra Y CxP totalmente pagada
    if (existing.stage === 'COMPRADO' && STAGES_REQUIRING_SUPPLIER.includes(stage)) {
      const hasPurchasePriceValue = existing.purchasePrice && parseFloat(existing.purchasePrice) > 0;
      if (!hasPurchasePriceValue) {
        throw new AppError('Debes definir el Precio de Compra antes de avanzar de etapa', 400);
      }
      const paidPayable = await prisma.payable.findFirst({
        where: { vehicleId: id, type: 'PAYABLE', status: 'PAID' },
      });
      if (!paidPayable) {
        throw new AppError('Debes tener la compra totalmente pagada (CxP en estado PAID) antes de avanzar de etapa', 400);
      }
    }

    // Validar valor negociado obligatorio para salir de NEGOCIANDO
    const hasNegotiated = existing.negotiatedValue && parseFloat(existing.negotiatedValue) > 0;
    const hasPurchasePrice = existing.purchasePrice && parseFloat(existing.purchasePrice) > 0;
    if (STAGES_REQUIRING_VALUE.includes(stage) && !hasNegotiated) {
      throw new AppError('Debe definir el Valor Negociado antes de pasar a esta etapa', 400);
    }

    // Al regresar a NEGOCIANDO desde etapas posteriores: bloquear si hay precio de compra Y CxP
    if (stage === 'NEGOCIANDO' && existing.stage !== 'NEGOCIANDO') {
      const hasPurchasePriceValue = existing.purchasePrice && parseFloat(existing.purchasePrice) > 0;
      const payable = await prisma.payable.findFirst({
        where: { vehicleId: id, type: 'PAYABLE' },
      });
      if (hasPurchasePriceValue && payable) {
        throw new AppError('No puedes regresar a Negociando: ya registraste el precio de compra (CxP)', 400);
      }
    }

    // Validar proveedor obligatorio para etapas posteriores a COMPRADO
    if (STAGES_REQUIRING_SUPPLIER.includes(stage) && !existing.supplierId) {
      throw new AppError('Debe asignar un proveedor antes de pasar a esta etapa', 400);
    }

    // Validar socio obligatorio si participación < 100%
    if (STAGES_REQUIRING_SUPPLIER.includes(stage) && parseFloat(existing.participation) < 1 && !existing.partnerId) {
      throw new AppError('Debe asignar un socio cuando la participación es menor al 100%', 400);
    }

    // Validar precio de venta obligatorio para VENDIDO
    if (stage === 'VENDIDO' && !existing.salePrice) {
      throw new AppError('El precio de venta es obligatorio para marcar como vendido', 400);
    }

    // Validar comprador obligatorio para VENDIDO
    if (stage === 'VENDIDO' && !existing.buyerId) {
      throw new AppError('Debe asignar un cliente (comprador) para marcar como vendido', 400);
    }

    // Bloquear pasar a PUBLICADO sin listedPrice
    if (stage === 'PUBLICADO' && !(existing.listedPrice && parseFloat(existing.listedPrice) > 0)) {
      throw new AppError('Debe definir el Precio Publicado antes de pasar a Publicado', 400);
    }

    // Bloquear pasar a DISPONIBLE sin salePrice o saleDate
    if (stage === 'DISPONIBLE') {
      const hasSalePrice = existing.salePrice && parseFloat(existing.salePrice) > 0;
      if (!hasSalePrice) {
        throw new AppError('Debe definir el Precio de Venta antes de pasar a Disponible', 400);
      }
      if (!existing.saleDate) {
        throw new AppError('Debe definir la Fecha de Venta antes de pasar a Disponible', 400);
      }
    }

    const updateData = { stage };

    // Al regresar a NEGOCIANDO: limpiar purchasePrice y purchaseDate para forzar re-registro de compra
    if (stage === 'NEGOCIANDO' && existing.stage !== 'NEGOCIANDO') {
      updateData.purchasePrice = null;
      updateData.purchaseDate = null;
    }

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

    // Calcular métricas antes de retornar
    const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });
    const fixedMonthly = fixedSetting ? parseFloat(fixedSetting.value) : 800000;

    return { ...vehicle, metrics: calculateVehicleMetrics(vehicle, fixedMonthly) };
  }

  async delete(id, userId) {
    const existing = await prisma.vehicle.findFirst({ where: { id, userId } });
    if (!existing) throw new AppError('Vehículo no encontrado', 404);

    if (existing.stage === 'VENDIDO') {
      throw new AppError('Vehículo VENDIDO: no se puede eliminar', 403);
    }

    // Cascade delete handles expenses and documents
    await prisma.vehicle.delete({ where: { id } });
    return { deleted: true };
  }
}

module.exports = new VehicleService();
