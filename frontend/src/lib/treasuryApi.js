// ═══════════════════════════════════════════════════════════════
// Treasury API — Endpoints de tesorería
// ═══════════════════════════════════════════════════════════════

import api from './api';

// ── Cuentas ──
export const accountsApi = {
  getAll: (params) => api.get('/treasury/accounts', { params }),
  getOne: (id) => api.get(`/treasury/accounts/${id}`),
  getTotalBalance: () => api.get('/treasury/accounts/total'),
  create: (data) => api.post('/treasury/accounts', data),
  update: (id, data) => api.put(`/treasury/accounts/${id}`, data),
  delete: (id) => api.delete(`/treasury/accounts/${id}`),
};

// ── Terceros ──
export const thirdPartiesApi = {
  getAll: (params) => api.get('/treasury/third-parties', { params }),
  getOne: (id) => api.get(`/treasury/third-parties/${id}`),
  getStatement: (id, params) => api.get(`/treasury/third-parties/${id}/statement`, { params }),
  create: (data) => api.post('/treasury/third-parties', data),
  update: (id, data) => api.put(`/treasury/third-parties/${id}`, data),
  delete: (id) => api.delete(`/treasury/third-parties/${id}`),
};

// ── Movimientos ──
export const transactionsApi = {
  getAll: (params) => api.get('/treasury/transactions', { params }),
  getOne: (id) => api.get(`/treasury/transactions/${id}`),
  getSummary: (params) => api.get('/treasury/transactions/summary', { params }),
  getByVehicle: (vehicleId) => api.get(`/treasury/transactions/vehicle/${vehicleId}`),
  createIncome: (data) => api.post('/treasury/transactions/income', data),
  createExpense: (data) => api.post('/treasury/transactions/expense', data),
  update: (id, data) => api.put(`/treasury/transactions/${id}`, data),
  // Movimientos inmutables: no hay delete. Las correcciones se hacen
  // editando el gasto origen o creando un nuevo movimiento.
};

// ── Transferencias ──
export const transfersApi = {
  getAll: (params) => api.get('/treasury/transfers', { params }),
  getOne: (id) => api.get(`/treasury/transfers/${id}`),
  create: (data) => api.post('/treasury/transfers', data),
  // Transferencias inmutables: tampoco hay delete.
};

// ── Arqueos ──
export const cashCountsApi = {
  getAll: (params) => api.get('/treasury/cash-counts', { params }),
  getOne: (id) => api.get(`/treasury/cash-counts/${id}`),
  getLastByAccount: (accountId) => api.get(`/treasury/cash-counts/account/${accountId}/last`),
  create: (data) => api.post('/treasury/cash-counts', data),
};

// ── Reportes ──
export const treasuryReportsApi = {
  getDashboard: () => api.get('/treasury/dashboard'),
  getCashFlow: (params) => api.get('/treasury/reports/cash-flow', { params }),
  getProjection: () => api.get('/treasury/reports/projection'),
  getVehicleTransactions: (vehicleId) => api.get(`/treasury/reports/vehicle/${vehicleId}`),
};

// ── Préstamos internos ──
export const loansApi = {
  getAll: (params) => api.get('/loans', { params }),
  getOne: (id) => api.get(`/loans/${id}`),
  getById: (id) => api.get(`/loans/${id}`),
  create: (data) => api.post('/loans', data),
  addPayment: (id, data) => api.post(`/loans/${id}/payments`, data),
  cancel: (id) => api.post(`/loans/${id}/cancel`),
};

// ── Créditos / financiaciones del negocio ──
export const debtsApi = {
  getAll: (params) => api.get('/debts', { params }),
  getById: (id) => api.get(`/debts/${id}`),
  create: (data) => api.post('/debts', data),
  addPayment: (id, data) => api.post(`/debts/${id}/payments`, data),
  reconcileCandidates: (params) => api.get('/debts/reconcile-candidates', { params }),
  reconcile: (id, data) => api.post(`/debts/${id}/reconcile`, data),
  cancel: (id) => api.post(`/debts/${id}/cancel`),
};
