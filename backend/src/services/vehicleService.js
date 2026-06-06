// ═══════════════════════════════════════════════════════════════
// Service — Vehicle (CRUD + lógica de negocio)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculateVehicleMetrics, calculateParticipation } = require('../utils/financial');
const storage = require('../utils/storage');

// Campos de participación/socio que quedan bloqueados después de NEGOCIANDO
const PARTNER_LOCKED_FIELDS = ['participation', 'partnerContribution', 'partnerId', 'partnerAssumesExpenses', 'purchasePrice'];

const VEHICLE_INCLUDE = {
  expenses: { orderBy: { createdAt: 'desc' } },
  documents: { orderBy: { createdAt: 'desc' } },
  supplier: { select: { id: true, name: true, document: true, phone: true, type: true } },
  partner: { select: { id: true, name: true, document: true, phone: true, type: true } },
  buyer: { select: { id: true, name: true, document: true, phone: true, type: true } },
  // Cruce: origen (cuando este vehículo nació de un cruce) y cruces recibidos
  // (cuando este vehículo se vendió y recibió otros como parte de pago).
  sourceVehicle: { select: { id: true, plate: true, stage: true, saleDate: true } },
  tradeInsReceived: { select: { id: true, plate: true, stage: true, negotiatedValue: true } },
};

// Etapas que requieren valor negociado/precio de compra (todas menos NEGOCIANDO)
const STAGES_REQUIRING_VALUE = ['COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'];
// Etapas que requieren proveedor obligatorio (después de COMPRADO)
const STAGES_REQUIRING_SUPPLIER = ['ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'];

// Campos de identidad física del vehículo. Una vez fuera de NEGOCIANDO solo ADMIN los edita.
const IDENTITY_FIELDS = ['plate', 'brand', 'model', 'year', 'color', 'km'];

// Campos escalares que se capturan en el snapshot de auditoría (sin relaciones ni timestamps de sistema).
const VEHICLE_SNAPSHOT_FIELDS = [
  'id', 'plate', 'brand', 'model', 'year', 'color', 'km', 'stage',
  'negotiatedValue', 'purchasePrice', 'listedPrice', 'salePrice',
  'participation', 'partnerContribution', 'partnerAssumesExpenses',
  'purchaseDate', 'saleDate', 'receivedVehicle', 'receivedVehiclePlate',
  'receivedVehicleValue', 'publishedPortals', 'supplierId', 'partnerId',
  'buyerId', 'notes',
];

function snapshot(vehicle) {
  return VEHICLE_SNAPSHOT_FIELDS.reduce((acc, f) => {
    const v = vehicle[f];
    if (v instanceof Date) acc[f] = v.toISOString();
    else if (Array.isArray(v)) acc[f] = [...v];
    else acc[f] = v?.toString?.() ?? v;
    return acc;
  }, {});
}

async function writeAudit(tx, { vehicleId, userId, action, before, after, reason }) {
  const data = { vehicleId, userId, action };
  if (before !== undefined && before !== null) data.before = before;
  if (after !== undefined && after !== null) data.after = after;
  if (reason) data.reason = reason;
  return tx.vehicleAuditLog.create({ data });
}

/**
 * Policy de edición por etapa y rol (ver spec edit-lock):
 *  - VENDIDO: lock absoluto, nadie edita (ni ADMIN).
 *  - Fuera de NEGOCIANDO: solo ADMIN puede tocar campos de identidad.
 * Las reglas previas (precio bloqueado con CxP, socio/proveedor inmutable) siguen aplicando aparte.
 */
function assertEditPolicy(existing, data, role) {
  if (existing.stage === 'VENDIDO') {
    throw new AppError('Vehículo VENDIDO: no se permiten cambios', 403);
  }
  if (existing.stage !== 'NEGOCIANDO' && role !== 'ADMIN') {
    const touched = IDENTITY_FIELDS.filter((f) => {
      if (!(f in data)) return false;
      return String(existing[f] ?? '') !== String(data[f] ?? '');
    });
    if (touched.length > 0) {
      throw new AppError(
        `Solo un administrador puede modificar ${touched.join(', ')} una vez registrada la compra`,
        403
      );
    }
  }
}

/**
 * Salda la compra de un vehículo recibido en cruce: crea una CxP marcada como PAGADA
 * (sin egreso de tesorería, porque se pagó entregando otro vehículo). Idempotente.
 */
async function settleTradeInPurchase(tx, { vehicleId, amount, plate, userId }) {
  const existingPayable = await tx.payable.findFirst({ where: { vehicleId, type: 'PAYABLE' } });
  if (existingPayable) return;
  await tx.payable.create({
    data: {
      type: 'PAYABLE',
      status: 'PAID',
      totalAmount: amount,
      paidAmount: amount,
      description: `Compra saldada por cruce: ${plate}`,
      vehicleId,
      createdBy: userId,
    },
  });
}

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

    // URL servible para cada documento (S3 prefirmada o /uploads en disco)
    const documents = await Promise.all(
      (vehicle.documents || []).map(async (d) => ({ ...d, url: await storage.getUrl(d.filepath) }))
    );

    // Comisiones devengadas/pagadas para el vehículo (Payable type=COMMISSION).
    // Hidratamos saleParticipant para que el cálculo agrupe por rol (CAPTADOR/CERRADOR).
    const commissionPayables = await prisma.payable.findMany({
      where: { vehicleId: id, type: 'COMMISSION' },
      include: { saleParticipant: { select: { role: true, sharePct: true } } },
    });

    return {
      ...vehicle,
      documents,
      commissionPayables,
      metrics: calculateVehicleMetrics(vehicle, fixedMonthly, commissionPayables),
    };
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

  async update(id, data, userId, { role } = {}) {
    // Verificar propiedad
    const existing = await prisma.vehicle.findFirst({ where: { id, userId } });
    if (!existing) throw new AppError('Vehículo no encontrado', 404);

    // Policy de etapa/rol: VENDIDO lock absoluto + identity solo ADMIN fuera de NEGOCIANDO.
    assertEditPolicy(existing, data, role);

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

    // Vehículos de cruce: no pueden tener socio ni participación parcial — son 100% del vendedor.
    if (existing.fromTradeIn) {
      const partnerFieldsTouched = ['partnerId', 'partnerContribution', 'partnerAssumesExpenses', 'participation']
        .filter(f => f in data && String(data[f] ?? '') !== String(existing[f] ?? ''));
      if (partnerFieldsTouched.length > 0) {
        throw new AppError(
          'Un vehículo recibido en cruce no admite socio: es 100% tuyo. No puedes modificar: ' +
          partnerFieldsTouched.join(', '),
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

    // Cruce → COMPRADO vía edición: fijar precio de compra = valor negociado del cruce
    const settlingTradeIn = existing.fromTradeIn && existing.stage === 'NEGOCIANDO' && payload.stage === 'COMPRADO';
    if (settlingTradeIn && !existing.purchasePrice && existing.negotiatedValue != null) {
      payload.purchasePrice = existing.negotiatedValue;
    }

    const before = snapshot(existing);

    const vehicle = await prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({
        where: { id },
        data: payload,
        include: VEHICLE_INCLUDE,
      });

      // Cruce → COMPRADO: la compra queda saldada por el cruce (CxP PAGADA, sin egreso)
      if (settlingTradeIn) {
        await settleTradeInPurchase(tx, { vehicleId: id, amount: existing.negotiatedValue, plate: updated.plate, userId });
      }

      const after = snapshot(updated);
      // Solo auditar si hubo cambios reales (el form reenvía todos los campos).
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await writeAudit(tx, { vehicleId: id, userId, action: 'UPDATE', before, after });
      }

      return updated;
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

    // Cruce → COMPRADO: fijar precio de compra = valor negociado del cruce
    const settlingTradeIn = existing.fromTradeIn && existing.stage === 'NEGOCIANDO' && stage === 'COMPRADO';
    if (settlingTradeIn && !existing.purchasePrice) {
      updateData.purchasePrice = existing.negotiatedValue;
    }

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: updateData,
      include: VEHICLE_INCLUDE,
    });

    // Cruce → COMPRADO: la compra queda saldada por el cruce (CxP PAGADA, sin egreso)
    if (settlingTradeIn) {
      await settleTradeInPurchase(prisma, { vehicleId: id, amount: existing.negotiatedValue, plate: vehicle.plate, userId });
    }

    // Auditar el cambio de etapa (solo si realmente cambió)
    if (existing.stage !== stage) {
      await writeAudit(prisma, {
        vehicleId: id,
        userId,
        action: 'STAGE_CHANGE',
        before: { stage: existing.stage },
        after: { stage },
      });
    }

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

  /**
   * Devuelve el audit log de un vehículo (orden cronológico DESC).
   * Autenticado, sin restricción de rol; sí valida propiedad.
   */
  async getAuditLog(id, userId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id, userId }, select: { id: true } });
    if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

    return prisma.vehicleAuditLog.findMany({
      where: { vehicleId: id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}

module.exports = new VehicleService();
