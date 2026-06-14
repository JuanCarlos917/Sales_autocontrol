import api from '@/lib/api';

export const usersApi = {
  getAll: () => api.get('/users'),
  create: (data) => api.post('/users', data),
  updateRole: (id, role) => api.patch(`/users/${id}/role`, { role }),
  setStatus: (id, isActive) => api.patch(`/users/${id}/status`, { isActive }),
  resetCredentials: (id, data) => api.patch(`/users/${id}/password`, data),
  remove: (id) => api.delete(`/users/${id}`),
};
