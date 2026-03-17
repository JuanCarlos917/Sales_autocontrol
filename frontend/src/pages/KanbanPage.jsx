import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/contexts/AppContext';
import { STAGES, PORTALS, formatCurrency, getStage } from '@/lib/constants';
import VehicleFormModal from '@/components/vehicles/VehicleFormModal';

export default function KanbanPage() {
  const { vehicles, fetchVehicles, moveVehicle, loading } = useApp();
  const [dragOver, setDragOver] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { fetchVehicles(); }, [fetchVehicles]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#8B949E]">{vehicles.length} vehículo{vehicles.length !== 1 ? 's' : ''} en el pipeline</p>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ Vehículo</button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-6 min-h-[calc(100vh-220px)] md:min-h-[calc(100vh-160px)]">
        {STAGES.map(stage => {
          const stageVehicles = vehicles.filter(v => v.stage === stage.id);
          const isOver = dragOver === stage.id;

          return (
            <div key={stage.id}
              onDragOver={e => { e.preventDefault(); setDragOver(stage.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => { e.preventDefault(); const vid = e.dataTransfer.getData('vid'); if (vid) moveVehicle(vid, stage.id); setDragOver(null); }}
              className={`min-w-[260px] max-w-[320px] flex-1 bg-surface rounded-xl border transition-colors flex flex-col ${isOver ? 'border-accent/30' : 'border-border'}`}
              style={isOver ? { background: stage.color + '08' } : {}}>

              {/* Column Header */}
              <div className="px-4 pt-4 pb-3 border-b border-border-light">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                    <span className="text-[13px] font-semibold">{stage.label}</span>
                  </div>
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: stage.color + '18', color: stage.color }}>
                    {stageVehicles.length}
                  </span>
                </div>
                <span className="text-[11px] text-[#6E7681]">{stage.desc}</span>
              </div>

              {/* Cards */}
              <div className="p-2 flex-1 flex flex-col gap-2 overflow-y-auto">
                {stageVehicles.length === 0 && (
                  <div className="p-5 text-center text-[#6E7681] text-xs border border-dashed border-border rounded-lg">
                    Arrastra un vehículo aquí
                  </div>
                )}
                {stageVehicles.map(v => {
                  const m = v.metrics || {};
                  const isAlert = m.daysInInventory > 15 && v.stage !== 'VENDIDO';
                  const portals = v.publishedPortals || [];

                  return (
                    <div key={v.id} draggable
                      onDragStart={e => e.dataTransfer.setData('vid', v.id)}
                      onClick={() => navigate(`/vehicles/${v.id}`)}
                      className="bg-[#161B22] border border-border rounded-lg p-3.5 cursor-pointer transition-all hover:border-accent/30 hover:-translate-y-0.5"
                      style={{ borderLeft: `3px solid ${isAlert ? (m.daysInInventory > 30 ? '#F85149' : '#D29922') : stage.color}` }}>

                      <div className="flex justify-between items-start">
                        <div>
                          <div className="plate-text">{v.plate || 'SIN PLACA'}</div>
                          <div className="text-xs text-[#8B949E]">{v.brand} {v.model} {v.year}</div>
                        </div>
                        {isAlert && <div className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: m.daysInInventory > 30 ? '#F85149' : '#D29922' }} />}
                      </div>

                      {portals.length > 0 && v.stage === 'PUBLICADO' && (
                        <div className="flex gap-1 flex-wrap mt-2">
                          {portals.map(pid => {
                            const p = PORTALS.find(x => x.id === pid);
                            return p ? <span key={pid} className="portal-badge" style={{ background: p.color + '20', color: p.color }}>{p.label}</span> : null;
                          })}
                        </div>
                      )}

                      <div className="flex justify-between mt-3 text-xs">
                        <div>
                          <div className="text-[#6E7681]">Inversión</div>
                          <div className="font-mono font-semibold">{formatCurrency(m.realCost)}</div>
                        </div>
                        {v.stage === 'VENDIDO' ? (
                          <div className="text-right">
                            <div className="text-[#6E7681]">Ganancia</div>
                            <div className={`font-mono font-bold ${m.netProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
                              {formatCurrency(m.netProfit)}
                            </div>
                          </div>
                        ) : m.daysInInventory > 0 ? (
                          <div className="text-right">
                            <div className="text-[#6E7681]">Días</div>
                            <div className={`font-mono font-bold ${m.daysInInventory > 30 ? 'text-[#F85149]' : m.daysInInventory > 15 ? 'text-[#D29922]' : ''}`}>
                              {m.daysInInventory}d
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {v.receivedVehicle && (
                        <div className="text-[11px] text-[#BC8CFF] mt-1.5">⟳ Cruce: {v.receivedVehiclePlate || 'Vehículo'}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showForm && <VehicleFormModal onClose={() => setShowForm(false)} />}
    </div>
  );
}
