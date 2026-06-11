// ═══════════════════════════════════════════════════════════════
// Vehicle Timeline Service
// Une eventos heterogéneos del vehículo en un solo array cronológico:
//   - VehicleAuditLog  (cambios de identidad/etapa)
//   - ExpenseAuditLog  (crear/editar/borrar/restaurar gasto)
//   - Transaction      (compra, gasto, ajuste, reverso, venta del vehículo)
//
// Cada evento se normaliza a la misma forma para que el frontend pinte
// timeline sin hacer ramas distintas por tipo en el render principal.
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

const USER_SELECT = { id: true, name: true, email: true };

async function getTimeline(vehicleId, userId) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, userId },
    select: { id: true },
  });
  if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

  const [vehicleAudits, expenseAudits, transactions] = await Promise.all([
    prisma.vehicleAuditLog.findMany({
      where: { vehicleId },
      include: { user: { select: USER_SELECT } },
    }),
    prisma.expenseAuditLog.findMany({
      where: { expense: { vehicleId } },
      include: {
        user: { select: USER_SELECT },
        expense: { select: { id: true, description: true, category: true } },
      },
    }),
    prisma.transaction.findMany({
      where: { vehicleId },
      include: {
        account: { select: { id: true, name: true, type: true } },
        thirdParty: { select: { id: true, name: true } },
      },
    }),
  ]);

  const events = [
    ...vehicleAudits.map((a) => ({
      type: 'VEHICLE_AUDIT',
      id: a.id,
      createdAt: a.createdAt,
      actor: a.user || null,
      action: a.action,
      category: null,
      amount: null,
      description: describeVehicleAudit(a),
      metadata: {
        before: a.before,
        after: a.after,
        reason: a.reason || null,
      },
    })),
    ...expenseAudits.map((a) => ({
      type: 'EXPENSE_AUDIT',
      id: a.id,
      createdAt: a.createdAt,
      actor: a.user || null,
      action: a.action,
      category: a.expense?.category || null,
      amount: extractAmount(a.action === 'CREATE' ? a.after : a.before),
      description: a.expense?.description || a.expense?.category || 'Gasto',
      metadata: {
        expenseId: a.expenseId,
        before: a.before,
        after: a.after,
        reason: a.reason || null,
      },
    })),
    ...transactions.map((t) => ({
      type: 'TRANSACTION',
      id: t.id,
      createdAt: t.createdAt,
      actor: null, // las Transaction no llevan user con relación cargada (createdBy es FK opcional)
      action: null,
      category: t.category,
      amount: t.amount,
      description: t.description || null,
      metadata: {
        transactionType: t.type,
        accountId: t.accountId,
        accountName: t.account?.name || null,
        thirdPartyId: t.thirdPartyId,
        thirdPartyName: t.thirdParty?.name || null,
        reversesTransactionId: t.reversesTransactionId || null,
        expenseId: t.expenseId,
        date: t.date,
      },
    })),
  ];

  // Más reciente primero, sin paginar (vehículos rara vez exceden 100 eventos)
  events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { events };
}

function describeVehicleAudit(a) {
  if (a.action === 'CREATE') return 'Vehículo creado';
  if (a.action === 'DELETE') return 'Vehículo eliminado';
  if (a.action === 'STAGE_CHANGE') {
    const from = a.before?.stage;
    const to = a.after?.stage;
    if (from && to) return `Etapa: ${from} → ${to}`;
    return 'Cambio de etapa';
  }
  if (a.action === 'UPDATE') {
    const keys = a.after ? Object.keys(a.after).filter((k) => k !== 'updatedAt') : [];
    if (keys.length === 1) return `Edición de ${keys[0]}`;
    if (keys.length > 1) return `Edición de ${keys.length} campos`;
    return 'Edición';
  }
  return a.action || 'Evento';
}

function extractAmount(snap) {
  if (!snap || typeof snap !== 'object') return null;
  const v = snap.amount;
  if (v === undefined || v === null) return null;
  return String(v);
}

module.exports = { getTimeline };
