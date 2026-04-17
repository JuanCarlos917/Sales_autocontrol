// ═══════════════════════════════════════════════════════════════
// PayablesWidget — Widget resumen de CxC/CxP
// ═══════════════════════════════════════════════════════════════

import { Link } from 'react-router-dom';
import { formatCurrency, formatDate } from '@/lib/constants';

export function ReceivablesWidget({ summary, overdueList = [], loading = false }) {
  if (loading) {
    return <WidgetSkeleton />;
  }

  const { total = 0, count = 0, overdueCount = 0 } = summary || {};
  const hasOverdue = overdueCount > 0;

  return (
    <div className={`card p-5 ${hasOverdue ? 'border-amber-500/40' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">📥</span>
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
            return (
              <div key={item.id} className="flex items-center justify-between text-xs p-2 bg-surface-hover rounded-lg">
                <div className="min-w-0 flex-1">
                  <div className="text-[#E6EDF3] truncate">
                    {item.vehicle?.plate || item.description || 'Sin descripcion'}
                  </div>
                  <div className="text-[#6E7681]">
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

      <Link
        to="/treasury/transactions?filter=receivables"
        className="block mt-4 text-center text-xs text-accent hover:text-accent/80 transition-colors"
      >
        Ver todas →
      </Link>
    </div>
  );
}

export function PayablesWidgetCxP({ summary, overdueList = [], upcomingList = [], loading = false }) {
  if (loading) {
    return <WidgetSkeleton />;
  }

  const { total = 0, count = 0, overdueCount = 0 } = summary || {};
  const hasOverdue = overdueCount > 0;

  return (
    <div className={`card p-5 ${hasOverdue ? 'border-red-500/40' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">📤</span>
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
            return (
              <div key={item.id} className="flex items-center justify-between text-xs p-2 bg-red-500/5 border border-red-500/20 rounded-lg">
                <div className="min-w-0 flex-1">
                  <div className="text-[#E6EDF3] truncate">
                    {item.vehicle?.plate || item.description || 'Sin descripcion'}
                  </div>
                  <div className="text-[#6E7681]">
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
            return (
              <div key={item.id} className="flex items-center justify-between text-xs p-2 bg-surface-hover rounded-lg">
                <div className="min-w-0 flex-1">
                  <div className="text-[#E6EDF3] truncate">
                    {item.vehicle?.plate || item.description || 'Sin descripcion'}
                  </div>
                  <div className="text-[#6E7681]">
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

      <Link
        to="/treasury/transactions?filter=payables"
        className="block mt-4 text-center text-xs text-accent hover:text-accent/80 transition-colors"
      >
        Ver todas →
      </Link>
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
