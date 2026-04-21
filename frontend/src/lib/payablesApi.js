// ═══════════════════════════════════════════════════════════════
// Payables API — Cliente para CxC / CxP
// ═══════════════════════════════════════════════════════════════

import api from './api';

export const payablesApi = {
  // Obtener todas las CxC/CxP con filtros
  getAll: (params = {}) => api.get('/payables', { params }),

  // Obtener resumen de CxC/CxP
  getSummary: () => api.get('/payables/summary'),

  // Obtener CxC/CxP proximas a vencer
  getUpcoming: (days = 7) => api.get('/payables/upcoming', { params: { days } }),

  // Obtener detalle de una CxC/CxP
  getById: (id) => api.get(`/payables/${id}`),

  // Crear una CxC/CxP
  create: (data) => api.post('/payables', data),

  // Registrar pago a una CxC/CxP
  addPayment: (id, paymentData) => api.post(`/payables/${id}/payments`, paymentData),

  // Cancelar una CxC/CxP
  cancel: (id) => api.post(`/payables/${id}/cancel`),
};

// ═══════════════════════════════════════════════════════════════
// Vehicle Purchase/Sale API extensions
// ═══════════════════════════════════════════════════════════════

export const vehicleTreasuryApi = {
  // Crear vehiculo con flujo de compra
  createWithPurchase: (data) => api.post('/vehicles/purchase', data),

  // Confirmar compra de un vehiculo en NEGOCIANDO
  confirmPurchase: (vehicleId, data) => api.post(`/vehicles/${vehicleId}/confirm-purchase`, data),

  // Obtener estado de pagos de un vehiculo
  getPaymentStatus: (vehicleId) => api.get(`/vehicles/${vehicleId}/payment-status`),

  // Agregar pago a compra de vehiculo
  addPurchasePayment: (vehicleId, paymentData) => api.post(`/vehicles/${vehicleId}/payments`, paymentData),

  // Registrar venta de vehiculo
  registerSale: (vehicleId, saleData) => api.post(`/vehicles/${vehicleId}/sell`, saleData),

  // Obtener resumen de venta
  getSaleSummary: (vehicleId) => api.get(`/vehicles/${vehicleId}/sale-summary`),

  // Agregar cobro a venta de vehiculo
  addSaleCollection: (vehicleId, collectionData) => api.post(`/vehicles/${vehicleId}/collections`, collectionData),

  // Cancelar venta
  cancelSale: (vehicleId) => api.post(`/vehicles/${vehicleId}/cancel-sale`),
};

// ═══════════════════════════════════════════════════════════════
// Expense Treasury API extensions
// ═══════════════════════════════════════════════════════════════

export const expenseTreasuryApi = {
  // Crear gasto con integracion de tesoreria
  createWithTreasury: (data) => api.post('/expenses/with-treasury', data),

  // Obtener gastos pendientes de pago
  getUnpaid: (vehicleId = null) => api.get('/expenses/unpaid', { params: { vehicleId } }),

  // Obtener estado de pago de un gasto
  getPaymentStatus: (expenseId) => api.get(`/expenses/${expenseId}/payment-status`),

  // Pagar un gasto
  payExpense: (expenseId, paymentData) => api.post(`/expenses/${expenseId}/pay`, paymentData),
};

export default payablesApi;
