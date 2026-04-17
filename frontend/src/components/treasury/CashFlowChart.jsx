// ═══════════════════════════════════════════════════════════════
// CashFlowChart — Grafico de flujo de caja (Ingresos vs Egresos)
// ═══════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import { formatCurrency } from '@/lib/constants';

export default function CashFlowChart({ data = [], loading = false, onPeriodChange }) {
  const [period, setPeriod] = useState('week');

  useEffect(() => {
    if (onPeriodChange) {
      onPeriodChange(period);
    }
  }, [period]);

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data;
  }, [data]);

  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="h-5 bg-surface-hover rounded w-32 animate-pulse" />
          <div className="h-8 bg-surface-hover rounded w-48 animate-pulse" />
        </div>
        <div className="h-48 bg-surface-hover rounded animate-pulse" />
      </div>
    );
  }

  const maxValue = Math.max(
    ...chartData.map(d => Math.max(d.income || 0, d.expense || 0)),
    1
  );

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Flujo de Caja</h3>
        <div className="flex gap-1 bg-surface-hover rounded-lg p-1">
          {[
            { id: 'week', label: '7D' },
            { id: 'month', label: '30D' },
            { id: 'quarter', label: '90D' },
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                period === p.id
                  ? 'bg-accent text-white'
                  : 'text-[#8B949E] hover:text-[#E6EDF3]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex gap-6 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-green-500" />
          <span className="text-xs text-[#8B949E]">Ingresos</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-red-500" />
          <span className="text-xs text-[#8B949E]">Egresos</span>
        </div>
      </div>

      {/* Grafico de barras */}
      {chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-[#6E7681] text-sm">
          Sin datos para este periodo
        </div>
      ) : (
        <div className="space-y-3">
          {chartData.map((day, idx) => {
            const incomePercent = (day.income / maxValue) * 100;
            const expensePercent = (day.expense / maxValue) * 100;
            const net = (day.income || 0) - (day.expense || 0);

            return (
              <div key={idx} className="group">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xs text-[#6E7681] w-16 shrink-0">
                    {day.label}
                  </span>
                  <div className="flex-1 flex gap-1 h-6">
                    {/* Barra de ingreso */}
                    <div
                      className="h-full bg-green-500/80 rounded-sm transition-all duration-300 hover:bg-green-500"
                      style={{ width: `${incomePercent}%`, minWidth: day.income > 0 ? '4px' : '0' }}
                      title={`Ingresos: ${formatCurrency(day.income)}`}
                    />
                    {/* Barra de egreso */}
                    <div
                      className="h-full bg-red-500/80 rounded-sm transition-all duration-300 hover:bg-red-500"
                      style={{ width: `${expensePercent}%`, minWidth: day.expense > 0 ? '4px' : '0' }}
                      title={`Egresos: ${formatCurrency(day.expense)}`}
                    />
                  </div>
                  <span className={`text-xs font-mono font-semibold w-24 text-right ${
                    net >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {net >= 0 ? '+' : ''}{formatCurrency(net)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Totales del periodo */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-border">
          <div className="text-center">
            <div className="text-xs text-[#6E7681] mb-1">Total Ingresos</div>
            <div className="text-sm font-bold text-green-400">
              {formatCurrency(chartData.reduce((s, d) => s + (d.income || 0), 0))}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-[#6E7681] mb-1">Total Egresos</div>
            <div className="text-sm font-bold text-red-400">
              {formatCurrency(chartData.reduce((s, d) => s + (d.expense || 0), 0))}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-[#6E7681] mb-1">Flujo Neto</div>
            {(() => {
              const netTotal = chartData.reduce((s, d) => s + (d.income || 0) - (d.expense || 0), 0);
              return (
                <div className={`text-sm font-bold ${netTotal >= 0 ? 'text-accent' : 'text-orange-400'}`}>
                  {netTotal >= 0 ? '+' : ''}{formatCurrency(netTotal)}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
