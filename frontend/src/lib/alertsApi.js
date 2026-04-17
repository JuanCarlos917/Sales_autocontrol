// ═══════════════════════════════════════════════════════════════
// Alerts API — Cliente para alertas del sistema
// ═══════════════════════════════════════════════════════════════

import api from './api';

export const alertsApi = {
  getAll: () => api.get('/alerts'),
  getSummary: () => api.get('/alerts/summary'),
};

export default alertsApi;
