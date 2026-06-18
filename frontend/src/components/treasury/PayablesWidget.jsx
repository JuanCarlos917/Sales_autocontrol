// ═══════════════════════════════════════════════════════════════
// PayablesWidget — Widget resumen de CxC/CxP
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatCurrency, formatDate } from '@/lib/constants';
import { ArrowDownLeft, ArrowUpRight, Car } from 'lucide-react';
import { payablesApi } from '@/lib/payablesApi';

export function ReceivablesWidget({ summary, overdueList = [], loading = false }) {
  const navigate = useNavigate();

  if (loading) {
    return <WidgetSkeleton />;
  }

  const { total = 0, count = 0, overdueCount = 0 } = summary || {};
  const hasOverdue = overdueCount > 0;

  const handleItemClick = (item) => {
    if (item.vehicleId) {
      navigate(`/vehicles/${item.vehicleId}?tab=tesoreria`);
    }
  };

  return (
    <div className={`card p-5 ${hasOverdue ? 'border-amber-500/40' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ArrowDownLeft className="w-5 h-5" />
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Por Cobrar (CxC)</h3>
        </div>
        {hasOverdue && (
          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs font-semibold rounded">
            {overdueCount} vencido{overdueCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="text-2xl font-bold text-green-400 mb-1">
        {formatCurrency(total)}
      </div>
      <div className="text-xs text-[#6E7681] mb-4">
        {count} cuenta{count !== 1 ? 's' : ''} pendiente{count !== 1 ? 's' : ''}
      </div>

      {/* Lista de vencidos */}
      {overdueList.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border">
          <div className="text-xs text-amber-400 font-semibold mb-2">Vencidas:</div>
          {overdueList.slice(0, 3).map((item) => {
            const pending = parseFloat(item.totalAmount) - parseFloat(item.paidAmount);
            const hasVehicle = !!item.vehicleId;
            return (
              <div
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={`flex items-center justify-between text-xs p-2 bg-surface-hover rounded-lg ${
                  hasVehicle ? 'cursor-pointer hover:bg-amber-500/10 hover:border-amber-500/30 border border-transparent transition-colors' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[#E6EDF3] truncate flex items-center gap-1">
                    {hasVehicle && <Car className="w-3.5 h-3.5 text-amber-400" />}
                    <span className={hasVehicle ? 'font-mono text-amber-300' : ''}>
                      {item.vehicle?.plate || item.description || 'Sin descripcion'}
                    </span>
                  </div>
                  <div className="text-[#6E7681]">
                    {item.vehicle && <span>{item.vehicle.brand} {item.vehicle.model} · </span>}
                    Vencio {formatDate(item.dueDate)}
                  </div>
                </div>
                <div className="text-amber-400 font-mono font-semibold ml-2">
                  {formatCurrency(pending)}
                </div>
              </div>
            );
          })}
          {overdueList.length > 3 && (
            <div className="text-xs text-[#6E7681] text-center pt-1">
              +{overdueList.length - 3} mas...
            </div>
          )}
        </div>
      )}

      {/* Cobro mas antiguo */}
      {overdueList.length === 0 && summary?.count > 0 && (
        <OldestReceivable navigate={navigate} />
      )}

      <Link
        to="/treasury/payables?type=receivable"
        className="block mt-4 text-center text-xs text-accent hover:text-accent/80 transition-colors"
      >
        Ver todas →
      </Link>
    </div>
  );
}

function OldestReceivable({ navigate }) {
  const [oldest, setOldest] = useState(null);

  useEffect(() => {
    loadOldest();
  }, []);

  const loadOldest = async () => {
    try {
      const { data } = await payablesApi.getAll({ type: 'RECEIVABLE' });
      const pending = (data || []).filter(p => p.status === 'PENDING' || p.status === 'PARTIAL');
      if (pending.length > 0) {
        // Ordenar por fecha de creacion (mas antiguo primero)
        const sorted = pending.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        setOldest(sorted[0]);
      }
    } catch (err) {
      console.error('Error loading oldest receivable:', err);
    }
  };

  if (!oldest) return null;

  const pending = parseFloat(oldest.totalAmount) - parseFloat(oldest.paidAmount);
  const hasVehicle = !!oldest.vehicleId;
  const daysOld = Math.floor((new Date() - new Date(oldest.createdAt)) / (1000 * 60 * 60 * 24));

  return (
    <div className="pt-3 border-t border-border mt-3">
      <div className="text-xs text-[#8B949E] mb-2">Cobro mas antiguo:</div>
      <div
        onClick={() => hasVehicle && navigate(`/vehicles/${oldest.vehicleId}?tab=tesoreria`)}
        className={`flex items-center justify-between text-xs p-2 bg-surface-hover rounded-lg ${
          hasVehicle ? 'cursor-pointer hover:bg-green-500/10 transition-colors' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[#E6EDF3] truncate flex items-center gap-1">
            {hasVehicle && <Car className="w-3.5 h-3.5 text-green-400" />}
            <span className={hasVehicle ? 'font-mono text-green-300' : ''}>
              {oldest.vehicle?.plate || oldest.description || 'Sin descripcion'}
            </span>
          </div>
          <div className="text-[#6E7681]">
            {oldest.vehicle && <span>{oldest.vehicle.brand} {oldest.vehicle.model} · </span>}
            Hace {daysOld} dia{daysOld !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="text-green-400 font-mono font-semibold ml-2">
          {formatCurrency(pending)}
        </div>
      </div>
    </div>
  );
}

export function PayablesWidgetCxP({ summary, overdueList = [], upcomingList = [], loading = false }) {
  const navigate = useNavigate();

  if (loading) {
    return <WidgetSkeleton />;
  }

  const { total = 0, count = 0, overdueCount = 0 } = summary || {};
  const hasOverdue = overdueCount > 0;

  const handleItemClick = (item) => {
    if (item.vehicleId) {
      navigate(`/vehicles/${item.vehicleId}?tab=tesoreria`);
    }
  };

  return (
    <div className={`card p-5 ${hasOverdue ? 'border-red-500/40' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ArrowUpRight className="w-5 h-5" />
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Por Pagar (CxP)</h3>
        </div>
        {hasOverdue && (
          <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs font-semibold rounded">
            {overdueCount} vencido{overdueCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="text-2xl font-bold text-red-400 mb-1">
        {formatCurrency(total)}
      </div>
      <div className="text-xs text-[#6E7681] mb-4">
        {count} cuenta{count !== 1 ? 's' : ''} pendiente{count !== 1 ? 's' : ''}
      </div>

      {/* Lista de vencidos */}
      {overdueList.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border">
          <div className="text-xs text-red-400 font-semibold mb-2">Vencidas:</div>
          {overdueList.slice(0, 3).map((item) => {
            const pending = parseFloat(item.totalAmount) - parseFloat(item.paidAmount);
            const hasVehicle = !!item.vehicleId;
            return (
              <div
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={`flex items-center justify-between text-xs p-2 bg-red-500/5 border border-red-500/20 rounded-lg ${
                  hasVehicle ? 'cursor-pointer hover:bg-red-500/10 hover:border-red-500/40 transition-colors' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[#E6EDF3] truncate flex items-center gap-1">
                    {hasVehicle && <Car className="w-3.5 h-3.5 text-red-400" />}
                    <span className={hasVehicle ? 'font-mono text-red-300' : ''}>
                      {item.vehicle?.plate || item.description || 'Sin descripcion'}
                    </span>
                  </div>
                  <div className="text-[#6E7681]">
                    {item.vehicle && <span>{item.vehicle.brand} {item.vehicle.model} · </span>}
                    Vencio {formatDate(item.dueDate)}
                  </div>
                </div>
                <div className="text-red-400 font-mono font-semibold ml-2">
                  {formatCurrency(pending)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Proximos vencimientos */}
      {upcomingList.length > 0 && overdueList.length === 0 && (
        <div className="space-y-2 pt-3 border-t border-border">
          <div className="text-xs text-[#8B949E] font-semibold mb-2">Proximos vencimientos:</div>
          {upcomingList.filter(u => u.type === 'PAYABLE').slice(0, 3).map((item) => {
            const pending = parseFloat(item.totalAmount) - parseFloat(item.paidAmount);
            const daysUntil = Math.ceil((new Date(item.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
            const hasVehicle = !!item.vehicleId;
            return (
              <div
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={`flex items-center justify-between text-xs p-2 bg-surface-hover rounded-lg ${
                  hasVehicle ? 'cursor-pointer hover:bg-surface-hover/80 border border-transparent hover:border-border transition-colors' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[#E6EDF3] truncate flex items-center gap-1">
                    {hasVehicle && <Car className="w-3.5 h-3.5 text-[#8B949E]" />}
                    <span className={hasVehicle ? 'font-mono' : ''}>
                      {item.vehicle?.plate || item.description || 'Sin descripcion'}
                    </span>
                  </div>
                  <div className="text-[#6E7681]">
                    {item.vehicle && <span>{item.vehicle.brand} {item.vehicle.model} · </span>}
                    Vence en {daysUntil} dia{daysUntil !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="text-[#8B949E] font-mono font-semibold ml-2">
                  {formatCurrency(pending)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Proximo a vencer (cuando no hay vencidos ni proximos mostrados) */}
      {overdueList.length === 0 && upcomingList.filter(u => u.type === 'PAYABLE').length === 0 && summary?.count > 0 && (
        <NextToExpirePayable navigate={navigate} />
      )}

      <Link
        to="/treasury/payables?type=payable"
        className="block mt-4 text-center text-xs text-accent hover:text-accent/80 transition-colors"
      >
        Ver todas →
      </Link>
    </div>
  );
}

function NextToExpirePayable({ navigate }) {
  const [nextPayables, setNextPayables] = useState([]);

  useEffect(() => {
    loadNext();
  }, []);

  const loadNext = async () => {
    try {
      const { data } = await payablesApi.getAll({ type: 'PAYABLE' });
      const pending = (data || []).filter(p =>
        (p.status === 'PENDING' || p.status === 'PARTIAL') && p.dueDate
      );
      if (pending.length > 0) {
        // Ordenar por fecha de vencimiento (mas proximo primero)
        const sorted = pending.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        setNextPayables(sorted);
      }
    } catch (err) {
      console.error('Error loading next payables:', err);
    }
  };

  if (nextPayables.length === 0) return null;

  const next = nextPayables[0];
  const remaining = nextPayables.length - 1;
  const pending = parseFloat(next.totalAmount) - parseFloat(next.paidAmount);
  const hasVehicle = !!next.vehicleId;
  const daysUntil = Math.ceil((new Date(next.dueDate) - new Date()) / (1000 * 60 * 60 * 24));

  return (
    <div className="pt-3 border-t border-border mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-[#8B949E]">Proximo a vencer:</div>
        {remaining > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 font-semibold">
            +{remaining}
          </span>
        )}
      </div>
      <div
        onClick={() => hasVehicle && navigate(`/vehicles/${next.vehicleId}?tab=tesoreria`)}
        className={`flex items-center justify-between text-xs p-2 bg-surface-hover rounded-lg ${
          hasVehicle ? 'cursor-pointer hover:bg-red-500/10 transition-colors' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[#E6EDF3] truncate flex items-center gap-1">
            {hasVehicle && <Car className="w-3.5 h-3.5 text-red-400" />}
            <span className={hasVehicle ? 'font-mono text-red-300' : ''}>
              {next.vehicle?.plate || next.description || 'Sin descripcion'}
            </span>
          </div>
          <div className="text-[#6E7681]">
            {next.vehicle && <span>{next.vehicle.brand} {next.vehicle.model} · </span>}
            {daysUntil <= 0 ? 'Vence hoy' : `Vence en ${daysUntil} dia${daysUntil !== 1 ? 's' : ''}`}
          </div>
        </div>
        <div className="text-red-400 font-mono font-semibold ml-2">
          {formatCurrency(pending)}
        </div>
      </div>
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="card p-5 animate-pulse">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 bg-surface-hover rounded" />
        <div className="h-4 bg-surface-hover rounded w-32" />
      </div>
      <div className="h-8 bg-surface-hover rounded w-40 mb-2" />
      <div className="h-3 bg-surface-hover rounded w-24" />
    </div>
  );
}

export default function PayablesWidget({ receivables, payables, overdueReceivables, overduePayables, upcoming, loading }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ReceivablesWidget
        summary={receivables}
        overdueList={overdueReceivables}
        loading={loading}
      />
      <PayablesWidgetCxP
        summary={payables}
        overdueList={overduePayables}
        upcomingList={upcoming}
        loading={loading}
      />
    </div>
  );
}
