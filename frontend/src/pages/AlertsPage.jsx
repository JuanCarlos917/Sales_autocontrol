// ═══════════════════════════════════════════════════════════════
// AlertsPage — Vista de todas las alertas del sistema
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { alertsApi } from '@/lib/alertsApi';
import Alert from '@/components/shared/Alert';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    try {
      const { data } = await alertsApi.getAll();
      setAlerts(data || []);
    } catch (err) {
      console.error('Error loading alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredAlerts = alerts.filter(alert => {
    if (filter === 'all') return true;
    if (filter === 'error') return alert.type === 'error';
    if (filter === 'warning') return alert.type === 'warning';
    if (filter === 'balance') return alert.category === 'balance';
    if (filter === 'payables') return alert.category === 'payables';
    if (filter === 'vehicles') return alert.category === 'vehicles';
    return true;
  });

  const errorCount = alerts.filter(a => a.type === 'error').length;
  const warningCount = alerts.filter(a => a.type === 'warning').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#8B949E]">Cargando alertas...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#E6EDF3]">Alertas del Sistema</h2>
          <p className="text-sm text-[#6E7681] mt-1">
            {alerts.length === 0
              ? 'No hay alertas activas'
              : `${alerts.length} alerta${alerts.length > 1 ? 's' : ''} activa${alerts.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={loadAlerts} className="btn-ghost text-sm">
          ↻ Actualizar
        </button>
      </div>

      {/* Resumen */}
      {alerts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div
            onClick={() => setFilter('all')}
            className={`card p-4 text-center cursor-pointer transition-colors ${
              filter === 'all' ? 'border-accent' : 'hover:bg-surface-hover'
            }`}
          >
            <div className="text-2xl font-bold text-[#E6EDF3]">{alerts.length}</div>
            <div className="text-xs text-[#6E7681]">Total</div>
          </div>
          <div
            onClick={() => setFilter('error')}
            className={`card p-4 text-center cursor-pointer transition-colors ${
              filter === 'error' ? 'border-red-500' : 'hover:bg-surface-hover'
            }`}
          >
            <div className="text-2xl font-bold text-red-400">{errorCount}</div>
            <div className="text-xs text-[#6E7681]">Criticas</div>
          </div>
          <div
            onClick={() => setFilter('warning')}
            className={`card p-4 text-center cursor-pointer transition-colors ${
              filter === 'warning' ? 'border-amber-500' : 'hover:bg-surface-hover'
            }`}
          >
            <div className="text-2xl font-bold text-amber-400">{warningCount}</div>
            <div className="text-xs text-[#6E7681]">Advertencias</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-2xl font-bold text-green-400">
              {alerts.length === 0 ? '✓' : '—'}
            </div>
            <div className="text-xs text-[#6E7681]">Estado</div>
          </div>
        </div>
      )}

      {/* Filtros por categoria */}
      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'balance', label: 'Saldos' },
            { id: 'payables', label: 'CxC/CxP' },
            { id: 'vehicles', label: 'Vehiculos' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                filter === f.id
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'border-border text-[#8B949E] hover:bg-surface-hover'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Lista de alertas */}
      {filteredAlerts.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-4">✅</div>
          <div className="text-lg font-semibold text-[#E6EDF3] mb-2">
            {filter === 'all' ? 'Sin alertas' : 'Sin alertas en esta categoria'}
          </div>
          <div className="text-sm text-[#6E7681]">
            {filter === 'all'
              ? 'Todo esta funcionando correctamente'
              : 'No hay alertas que coincidan con el filtro'}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAlerts.map((alert) => (
            <Alert
              key={alert.id}
              type={alert.type}
              title={alert.title}
              message={alert.message}
              details={alert.details}
              action={alert.entityType === 'vehicle' ? () => window.location.href = `/vehicles/${alert.entityId}` : undefined}
              actionLabel={alert.entityType === 'vehicle' ? 'Ver vehiculo' : undefined}
            />
          ))}
        </div>
      )}

      {/* Acciones rapidas */}
      {alerts.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-semibold text-[#E6EDF3] mb-3">Acciones Rapidas</div>
          <div className="flex flex-wrap gap-2">
            <Link to="/treasury" className="btn-ghost text-sm">
              Ver Tesoreria →
            </Link>
            <Link to="/vehicles" className="btn-ghost text-sm">
              Ver Vehiculos →
            </Link>
            <Link to="/treasury/transactions" className="btn-ghost text-sm">
              Ver Movimientos →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
