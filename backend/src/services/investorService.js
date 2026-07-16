// ═══════════════════════════════════════════════════════════════
// Investor Service — Reporte por persona de ganancia (Payable PROFIT_SHARE)
//
// No duplica lógica: reutiliza las funciones de agregación de
// commissionService (ya parametrizadas por PayableType) con
// payableType: 'PROFIT_SHARE', y reutiliza el flujo genérico de
// payableService.addPayment para registrar pagos — el mismo mecanismo
// (Transaction + PayablePayment + treasuryAudit) que usan las comisiones,
// sin reimplementarlo.
// ═══════════════════════════════════════════════════════════════

const commissionService = require('./commissionService');
const payableService = require('./payableService');

const PAYABLE_TYPE = 'PROFIT_SHARE';

/**
 * Agregados de ganancia por inversionista para Dashboard + sección "Por persona".
 * Mismo shape que commissionService.getSummary: { pendingTotal, paidThisMonth, byPerson }.
 */
async function getSummary(prismaOrTx) {
  return commissionService.getSummary(prismaOrTx, { payableType: PAYABLE_TYPE });
}

/**
 * Lista items de ganancia agrupados por vehículo vendido, pendientes primero.
 * status: 'pending' | 'paid' | 'all' (default all, vía commissionService).
 */
async function listByVehicle(prismaOrTx, { status } = {}) {
  return commissionService.listByVehicle(prismaOrTx, { status, payableType: PAYABLE_TYPE });
}

/**
 * Registra un pago contra una CxP PROFIT_SHARE. Delega en payableService.addPayment
 * (agnóstico al PayableType): valida cuenta activa, bloquea filas payable+account
 * dentro de una transacción, verifica saldo, crea Transaction + PayablePayment,
 * actualiza paidAmount/status del payable y escribe treasuryAudit.
 */
async function addPayment(payableId, paymentData, userId) {
  return payableService.addPayment(payableId, paymentData, userId);
}

module.exports = {
  getSummary,
  listByVehicle,
  addPayment,
  PAYABLE_TYPE,
};
