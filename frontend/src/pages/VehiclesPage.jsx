import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/contexts/AppContext';
import { STAGES, PORTALS, formatCurrency, getStage } from '@/lib/constants';

export default function VehiclesPage() {
  const { vehicles, fetchVehicles } = useApp();
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();

  useEffect(() => { fetchVehicles(); }, [fetchVehicles]);

  const filtered = filter === 'all' ? vehicles : vehicles.filter(v => v.stage === filter);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${filter === 'all' ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border text-[#6E7681]'}`}>
            Todos ({vehicles.length})
          </button>
          {STAGES.map(s => {
            const count = vehicles.filter(v => v.stage === s.id).length;
            return (
              <button key={s.id} onClick={() => setFilter(s.id)} className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${filter === s.id ? 'border-opacity-40' : 'border-border text-[#6E7681]'}`} style={filter === s.id ? { background: s.color + '18', borderColor: s.color + '60', color: s.color } : {}}>
                {s.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-[#6E7681]">
          <div className="text-4xl mb-3">☰</div>
          <p>No hay vehículos en esta categoría</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(v => {
            const m = v.metrics || {};
            const stage = getStage(v.stage);
            const portals = v.publishedPortals || [];
            return (
              <div key={v.id} onClick={() => navigate(`/vehicles/${v.id}`)} className="bg-surface border border-border rounded-xl p-4 cursor-pointer transition-all hover:border-accent/30 hover:-translate-y-0.5">
                <div className="flex justify-between mb-3">
                  <div>
                    <div className="plate-text">{v.plate || 'SIN PLACA'}</div>
                    <div className="text-[13px] text-[#8B949E]">{v.brand} {v.model} {v.year}</div>
                  </div>
                  <span className="stage-badge h-fit" style={{ background: stage.color + '18', color: stage.color }}>{stage.label}</span>
                </div>
                {portals.length > 0 && (
                  <div className="flex gap-1 flex-wrap mb-2">
                    {portals.map(pid => { const p = PORTALS.find(x => x.id === pid); return p ? <span key={pid} className="portal-badge" style={{ background: p.color + '15', color: p.color }}>{p.label}</span> : null; })}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-[#6E7681]">Inversión</div><div className="font-mono font-semibold">{formatCurrency(m.realCost)}</div></div>
                  <div><div className="text-[#6E7681]">Días</div><div className={`font-mono font-semibold ${m.daysInInventory > 30 ? 'text-[#F85149]' : ''}`}>{m.daysInInventory || 0}d</div></div>
                  <div><div className="text-[#6E7681]">{v.stage === 'VENDIDO' ? 'Ganancia' : 'Gastos'}</div><div className={`font-mono font-bold ${v.stage === 'VENDIDO' ? (m.netProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]') : 'text-[#D29922]'}`}>{v.stage === 'VENDIDO' ? formatCurrency(m.netProfit) : formatCurrency(m.totalExpenses)}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
