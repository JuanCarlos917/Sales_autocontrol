import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '@/contexts/AppContext';
import api from '@/lib/api';
import { STAGES, EXPENSE_CATEGORIES, PORTALS, DOC_TYPES, formatCurrency, formatPercent, formatDate, getStage, getCategory } from '@/lib/constants';
import VehicleFormModal from '@/components/vehicles/VehicleFormModal';
import ExpenseFormModal from '@/components/expenses/ExpenseFormModal';
import DocumentFormModal from '@/components/documents/DocumentFormModal';

export default function VehicleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { moveVehicle, deleteVehicle, deleteExpense, deleteDocument } = useApp();
  const [vehicle, setVehicle] = useState(null);
  const [tab, setTab] = useState('resumen');
  const [showEditForm, setShowEditForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const loadVehicle = async () => {
    try {
      const { data } = await api.get(`/vehicles/${id}`);
      setVehicle(data);
    } catch { navigate('/vehicles'); }
  };

  useEffect(() => { loadVehicle(); }, [id]);

  if (!vehicle) return <div className="text-center text-[#6E7681] py-20">Cargando...</div>;

  const m = vehicle.metrics || {};
  const stage = getStage(vehicle.stage);
  const stageIdx = STAGES.findIndex(s => s.id === vehicle.stage);
  const expenses = vehicle.expenses || [];
  const docs = vehicle.documents || [];
  const portals = vehicle.publishedPortals || [];

  const handleMove = async (newStage) => {
    await moveVehicle(id, newStage);
    loadVehicle();
  };

  const handleDelete = async () => {
    await deleteVehicle(id);
    navigate('/vehicles');
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="card mb-4" style={{ background: `linear-gradient(135deg, ${stage.color}08 0%, transparent 60%)` }}>
        <div className="flex justify-between items-start flex-wrap gap-3">
          <div>
            <div className="plate-text text-2xl">{vehicle.plate || 'SIN PLACA'}</div>
            <div className="text-[15px] text-[#8B949E] mt-0.5">
              {vehicle.brand} {vehicle.model} {vehicle.year}
              {vehicle.color ? ` · ${vehicle.color}` : ''}
              {vehicle.km ? ` · ${vehicle.km.toLocaleString()} km` : ''}
            </div>
            <div className="flex gap-2 items-center mt-2 flex-wrap">
              <span className="stage-badge" style={{ background: stage.color + '18', color: stage.color }}>{stage.label}</span>
              {m.daysInInventory > 0 && <span className="text-xs text-[#6E7681]">{m.daysInInventory} días en inventario</span>}
              {vehicle.receivedVehicle && <span className="text-xs text-[#BC8CFF]">⟳ Cruce: {vehicle.receivedVehiclePlate}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowEditForm(true)} className="btn-ghost">✏ Editar</button>
            <button onClick={() => navigate(-1)} className="btn-ghost">← Volver</button>
          </div>
        </div>

        {portals.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-3">
            {portals.map(pid => { const p = PORTALS.find(x => x.id === pid); return p ? <span key={pid} className="portal-badge" style={{ background: p.color + '20', color: p.color }}>{p.label}</span> : null; })}
          </div>
        )}

        {/* Stage Navigation */}
        <div className="flex gap-1.5 mt-4 overflow-x-auto">
          {STAGES.map(s => (
            <button key={s.id} onClick={() => handleMove(s.id)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-semibold border shrink-0 transition-colors ${vehicle.stage === s.id ? '' : 'border-border text-[#6E7681] hover:bg-surface-hover'}`}
              style={vehicle.stage === s.id ? { background: s.color + '18', borderColor: s.color + '50', color: s.color } : {}}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border mb-4">
        {[
          { id: 'resumen', label: 'Resumen' },
          { id: 'gastos', label: `Gastos (${expenses.length})` },
          { id: 'financiero', label: 'Financiero' },
          { id: 'documentos', label: `Docs (${docs.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${tab === t.id ? 'border-accent text-accent' : 'border-transparent text-[#6E7681]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'resumen' && (
        <div className="grid grid-cols-2 gap-4">
          <InfoItem label="Precio de Compra" value={formatCurrency(vehicle.purchasePrice)} />
          <InfoItem label="Fecha de Compra" value={formatDate(vehicle.purchaseDate)} />
          <InfoItem label="Precio Publicado" value={vehicle.listedPrice ? formatCurrency(vehicle.listedPrice) : '—'} />
          <InfoItem label="Precio de Venta" value={vehicle.salePrice ? formatCurrency(vehicle.salePrice) : '—'} />
          <InfoItem label="Fecha de Venta" value={formatDate(vehicle.saleDate)} />
          <InfoItem label="Participación" value={`${((vehicle.participation || 1) * 100)}%`} />
          {vehicle.receivedVehicle && <>
            <InfoItem label="Cruce Placa" value={vehicle.receivedVehiclePlate || '—'} />
            <InfoItem label="Valor Cruce" value={formatCurrency(vehicle.receivedVehicleValue)} />
          </>}
          {vehicle.notes && <div className="col-span-2"><InfoItem label="Notas" value={vehicle.notes} /></div>}
        </div>
      )}

      {tab === 'gastos' && (
        <div>
          <div className="flex justify-between mb-4">
            <span className="text-sm font-semibold">Total: {formatCurrency(m.totalExpenses)}</span>
            <button onClick={() => setShowExpenseForm(true)} className="btn-primary">+ Gasto</button>
          </div>
          {expenses.length === 0 ? <p className="text-center text-[#6E7681] py-10">Sin gastos registrados</p> : (
            <div className="space-y-2">
              {expenses.map(e => {
                const cat = getCategory(e.category);
                return (
                  <div key={e.id} className="flex items-start gap-3 p-3 bg-surface border border-border rounded-lg">
                    <div className="w-1 min-h-[36px] rounded-full shrink-0" style={{ background: cat?.color || '#6E7681' }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold truncate">{e.description || cat?.label}</div>
                          <div className="text-[11px] text-[#6E7681] flex gap-2 flex-wrap mt-0.5">
                            <span style={{ color: cat?.color }}>{cat?.label}</span>
                            {e.date && <span>{formatDate(e.date)}</span>}
                            {!e.paid && <span className="text-[#D29922] font-semibold">⏳ Pendiente</span>}
                          </div>
                          {e.notes && <div className="text-[11px] text-[#6E7681] italic mt-1">📝 {e.notes}</div>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-sm">{formatCurrency(e.amount)}</span>
                          <button onClick={() => { deleteExpense(e.id); loadVehicle(); }} className="btn-danger">✕</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'financiero' && (
        <div className="grid grid-cols-2 gap-3">
          <FinCard label="Valor de Compra" value={formatCurrency(vehicle.purchasePrice)} />
          <FinCard label="Total Gastos Variables" value={formatCurrency(m.totalExpenses)} color="text-[#D29922]" />
          <FinCard label="Gastos Fijos Prorrateados" value={formatCurrency(m.fixedProrated)} sub={`${m.daysInInventory}d`} />
          <FinCard label="COSTO REAL TOTAL" value={formatCurrency(m.realCostWithFixed)} color="text-accent" highlight />
          <FinCard label="Reparaciones" value={formatCurrency(m.repairs)} color="text-[#EF4444]" />
          <FinCard label="Comisiones" value={formatCurrency(m.commissions)} color="text-[#F472B6]" />
          <FinCard label="Trámites / Impuestos" value={formatCurrency(m.taxes)} color="text-[#5B8DEF]" />
          <FinCard label="Deuda Pendiente" value={formatCurrency(m.unpaidExpenses)} color={m.unpaidExpenses > 0 ? 'text-[#F85149]' : 'text-[#6E7681]'} />
          {vehicle.stage === 'VENDIDO' && <>
            <FinCard label="Valor de Venta" value={formatCurrency(vehicle.salePrice)} color="text-[#3FB950]" />
            <FinCard label="GANANCIA NETA" value={formatCurrency(m.netProfit)} color={m.netProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]'} highlight />
            <FinCard label="ROI" value={formatPercent(m.roi)} color={m.roi >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]'} />
            <FinCard label="MI GANANCIA REAL" value={formatCurrency(m.myProfit)} color="text-accent" highlight sub={`Part: ${((vehicle.participation || 1) * 100)}%`} />
          </>}
        </div>
      )}

      {tab === 'documentos' && (
        <div>
          <div className="flex justify-between mb-4">
            <span className="text-sm font-semibold">Documentos y Fotos</span>
            <button onClick={() => setShowDocForm(true)} className="btn-primary">+ Documento</button>
          </div>
          {docs.length === 0 ? <p className="text-center text-[#6E7681] py-10">Agrega tarjeta de propiedad, SOAT, peritaje, etc.</p> : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {docs.map(d => {
                const dtype = DOC_TYPES.find(t => t.id === d.type);
                const isImage = d.mimetype?.startsWith('image/');
                return (
                  <div key={d.id} className="bg-surface border border-border rounded-xl p-3">
                    <div className="text-[13px] font-semibold mb-2">{dtype?.label || d.type}</div>
                    {isImage && <img src={`/uploads/${d.filepath?.split('/uploads/')?.[1] || d.filepath}`} alt="" className="w-full rounded-lg mb-2 max-h-40 object-cover" />}
                    {d.notes && <div className="text-[11px] text-[#6E7681]">{d.notes}</div>}
                    <div className="flex justify-between mt-2 text-[11px] text-[#6E7681]">
                      <span>{formatDate(d.createdAt)}</span>
                      <button onClick={() => { deleteDocument(d.id); loadVehicle(); }} className="btn-danger text-[10px]">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex justify-between items-center mt-6 pt-4 border-t border-border flex-wrap gap-3">
        <div>
          {confirmDel ? (
            <div className="flex gap-2 items-center">
              <span className="text-xs text-[#F85149]">¿Eliminar todo?</span>
              <button onClick={handleDelete} className="btn-danger px-3 py-1">Sí</button>
              <button onClick={() => setConfirmDel(false)} className="btn-ghost text-xs">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDel(true)} className="btn-ghost text-[#F85149] border-[#F8514930]">🗑 Eliminar</button>
          )}
        </div>
        <div className="flex gap-2">
          {stageIdx > 0 && <button onClick={() => handleMove(STAGES[stageIdx - 1].id)} className="btn-ghost">← {STAGES[stageIdx - 1].label}</button>}
          {stageIdx < STAGES.length - 1 && (
            <button onClick={() => handleMove(STAGES[stageIdx + 1].id)} className="btn-primary" style={{ background: STAGES[stageIdx + 1].color }}>
              {STAGES[stageIdx + 1].label} →
            </button>
          )}
        </div>
      </div>

      {/* Modals */}
      {showEditForm && <VehicleFormModal vehicle={vehicle} onClose={() => { setShowEditForm(false); loadVehicle(); }} />}
      {showExpenseForm && <ExpenseFormModal vehicleId={id} onClose={() => { setShowExpenseForm(false); loadVehicle(); }} />}
      {showDocForm && <DocumentFormModal vehicleId={id} onClose={() => { setShowDocForm(false); loadVehicle(); }} />}
    </div>
  );
}

function InfoItem({ label, value }) {
  return (
    <div>
      <div className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function FinCard({ label, value, color = '', highlight, sub }) {
  return (
    <div className={`p-3 rounded-lg border ${highlight ? 'border-accent/20 bg-accent/5' : 'border-border bg-[#0F1419]'}`}>
      <div className="text-[10px] text-[#6E7681] uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-mono font-bold ${highlight ? 'text-xl' : 'text-base'} ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#6E7681] mt-0.5">{sub}</div>}
    </div>
  );
}
