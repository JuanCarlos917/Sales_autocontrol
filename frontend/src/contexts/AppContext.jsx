// ═══════════════════════════════════════════════════════════════
// Context — App (vehicles, expenses, dashboard, toast)
// ═══════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useCallback } from 'react';
import api from '@/lib/api';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [vehicles, setVehicles] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Vehicles ──
  const fetchVehicles = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const { data } = await api.get('/vehicles', { params });
      setVehicles(data);
      return data;
    } catch (err) {
      showToast(err.response?.data?.error || 'Error cargando vehículos', 'danger');
    } finally { setLoading(false); }
  }, [showToast]);

  const createVehicle = useCallback(async (payload) => {
    const { data } = await api.post('/vehicles', payload);
    setVehicles(prev => [data, ...prev]);
    showToast('Vehículo registrado');
    return data;
  }, [showToast]);

  const updateVehicle = useCallback(async (id, payload) => {
    const { data } = await api.put(`/vehicles/${id}`, payload);
    setVehicles(prev => prev.map(v => v.id === id ? data : v));
    showToast('Vehículo actualizado');
    return data;
  }, [showToast]);

  const moveVehicle = useCallback(async (id, stage) => {
    const { data } = await api.patch(`/vehicles/${id}/stage`, { stage });
    setVehicles(prev => prev.map(v => v.id === id ? data : v));
    return data;
  }, []);

  const deleteVehicle = useCallback(async (id) => {
    await api.delete(`/vehicles/${id}`);
    setVehicles(prev => prev.filter(v => v.id !== id));
    showToast('Vehículo eliminado', 'danger');
  }, [showToast]);

  // ── Expenses ──
  const fetchExpenses = useCallback(async (params = {}) => {
    const { data } = await api.get('/expenses', { params });
    setExpenses(data);
    return data;
  }, []);

  const createExpense = useCallback(async (payload) => {
    const { data } = await api.post('/expenses', payload);
    setExpenses(prev => [data, ...prev]);
    showToast('Gasto registrado');
    return data;
  }, [showToast]);

  const deleteExpense = useCallback(async (id) => {
    await api.delete(`/expenses/${id}`);
    setExpenses(prev => prev.filter(e => e.id !== id));
    showToast('Gasto eliminado', 'danger');
  }, [showToast]);

  // ── Documents ──
  const uploadDocument = useCallback(async (vehicleId, formData) => {
    const { data } = await api.post(`/documents/vehicle/${vehicleId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    showToast('Documento subido');
    return data;
  }, [showToast]);

  const deleteDocument = useCallback(async (id) => {
    await api.delete(`/documents/${id}`);
    showToast('Documento eliminado', 'danger');
  }, [showToast]);

  // ── Dashboard ──
  const fetchDashboard = useCallback(async () => {
    const { data } = await api.get('/dashboard/overview');
    setDashboard(data);
    return data;
  }, []);

  // ── Settings ──
  const fetchSettings = useCallback(async () => {
    const { data } = await api.get('/settings');
    return data;
  }, []);

  const updateSettings = useCallback(async (payload) => {
    await api.put('/settings', payload);
    showToast('Configuración guardada');
  }, [showToast]);

  // ── CSV Export ──
  const exportCSV = useCallback(() => {
    const rows = [['Placa','Marca','Modelo','Año','Estado','Compra','Venta','Días','Precio Compra','Gastos','Costo Real','Precio Venta','Ganancia','ROI']];
    vehicles.forEach(v => {
      const m = v.metrics || {};
      rows.push([v.plate, v.brand, v.model, v.year, v.stage, v.purchaseDate||'', v.saleDate||'', m.daysInInventory||0, v.purchasePrice||0, m.totalExpenses||0, m.realCostWithFixed||0, v.salePrice||0, m.netProfit||0, m.roi ? (m.roi*100).toFixed(1)+'%' : '']);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `autocontrol_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    showToast('CSV exportado');
  }, [vehicles, showToast]);

  const value = {
    vehicles, expenses, dashboard, loading, toast,
    showToast, fetchVehicles, createVehicle, updateVehicle, moveVehicle, deleteVehicle,
    fetchExpenses, createExpense, deleteExpense,
    uploadDocument, deleteDocument,
    fetchDashboard, fetchSettings, updateSettings, exportCSV,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
};
