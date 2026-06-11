import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import { EXPENSE_CATEGORIES, PORTALS, formatCurrency, formatPercent, formatDate, formatDateTime, getStage, getCategory } from '@/lib/constants';
import VehicleFormModal from '@/components/vehicles/VehicleFormModal';
import DocumentFormModal from '@/components/documents/DocumentFormModal';
import DocumentCard from '@/components/documents/DocumentCard';
import DocumentViewerModal from '@/components/documents/DocumentViewerModal';
import ExpenseFormModal from '@/components/expenses/ExpenseFormModal';
import ExpenseDeleteModal from '@/components/expenses/ExpenseDeleteModal';
import { transactionsApi, accountsApi } from '@/lib/treasuryApi';
import { vehicleTreasuryApi, payablesApi, expenseTreasuryApi } from '@/lib/payablesApi';
import { SalePaymentModal, PaymentModal, ExpensePaymentModal } from '@/components/treasury';

const UNDO_WINDOW_MS = 5 * 60 * 1000;

// ── Audit log: etiquetas y formato ───────────────────────────────
const AUDIT_ACTION_LABELS = {
  CREATE: 'Creación',
  UPDATE: 'Edición',
  STAGE_CHANGE: 'Cambio de etapa',
  DELETE: 'Eliminación',
};
const AUDIT_ACTION_COLORS = {
  CREATE: '#3FB950',
  UPDATE: '#D29922',
  STAGE_CHANGE: '#5B8DEF',
  DELETE: '#F85149',
};
const AUDIT_FIELD_LABELS = {
  plate: 'Placa', brand: 'Marca', model: 'Modelo', year: 'Año', color: 'Color', km: 'Kilometraje',
  stage: 'Etapa', negotiatedValue: 'Valor negociado', purchasePrice: 'Precio de compra',
  listedPrice: 'Precio publicado', salePrice: 'Precio de venta', participation: 'Participación',
  partnerContribution: 'Aporte socio', partnerAssumesExpenses: 'Prorrateo con socio',
  purchaseDate: 'Fecha de compra', saleDate: 'Fecha de venta', notes: 'Notas',
  supplierId: 'Proveedor', partnerId: 'Socio', buyerId: 'Comprador',
  receivedVehicle: 'Cruce', receivedVehiclePlate: 'Placa cruce', receivedVehicleValue: 'Valor cruce',
  publishedPortals: 'Portales',
};
const AUDIT_MONEY_FIELDS = new Set(['negotiatedValue', 'purchasePrice', 'listedPrice', 'salePrice', 'partnerContribution', 'receivedVehicleValue']);
const AUDIT_DATE_FIELDS = new Set(['purchaseDate', 'saleDate']);

function fmtAuditValue(field, val) {
  if (val === null || val === undefined || val === '') return '—';
  if (Array.isArray(val)) return val.length ? val.join(', ') : '—';
  if (AUDIT_MONEY_FIELDS.has(field)) return formatCurrency(val);
  if (AUDIT_DATE_FIELDS.has(field)) return formatDate(val);
  if (field === 'stage') return getStage(val)?.label || val;
  if (val === 'true') return 'Sí';
  if (val === 'false') return 'No';
  return String(val);
}

function diffAuditSnapshots(before, after) {
  if (!before && !after) return [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changes = [];
  for (const k of keys) {
    if (k === 'id') continue;
    const b = (before || {})[k];
    const a = (after || {})[k];
    const bs = Array.isArray(b) ? b.join(',') : (b ?? '');
    const as = Array.isArray(a) ? a.join(',') : (a ?? '');
    if (String(bs) !== String(as)) changes.push({ field: k, before: b, after: a });
  }
  return changes;
}

export default function VehicleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { deleteVehicle, deleteExpense, restoreExpense, deleteDocument, showToast } = useApp();
  const { role } = useAuth();
  const isViewer = role === 'VIEWER';
  const [editingExpense, setEditingExpense] = useState(null);
  const [deletingExpense, setDeletingExpense] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [tab, setTab] = useState(searchParams.get('tab') || 'resumen');
  const [showEditForm, setShowEditForm] = useState(false);

  // Cerrar formulario de edición y limpiar URL
  const closeEditForm = () => {
    setShowEditForm(false);
    if (searchParams.get('edit') || searchParams.get('highlight')) {
      searchParams.delete('edit');
      searchParams.delete('highlight');
      setSearchParams(searchParams, { replace: true });
    }
  };

  // Campos a destacar en rojo cuando se viene desde la alerta del Kanban
  const highlightFields = (searchParams.get('highlight') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const [showDocForm, setShowDocForm] = useState(false);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  // Tesorería
  const [vehicleTransactions, setVehicleTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  // Modales de tesorería
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showExpenseTreasuryModal, setShowExpenseTreasuryModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentModalConfig, setPaymentModalConfig] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [processingAction, setProcessingAction] = useState(false);

  const loadVehicle = async () => {
    try {
      const { data } = await api.get(`/vehicles/${id}`);
      setVehicle(data);
    } catch { navigate('/vehicles'); }
  };

  const loadVehicleTransactions = async () => {
    try {
      const { data } = await transactionsApi.getByVehicle(id);
      setVehicleTransactions(data);
    } catch (err) {
      console.error('Error loading vehicle transactions:', err);
    }
  };

  const loadAccounts = async () => {
    try {
      const { data } = await accountsApi.getAll();
      setAccounts(data);
    } catch (err) {
      console.error('Error loading accounts:', err);
    }
  };

  const loadPaymentStatus = async () => {
    try {
      const { data } = await vehicleTreasuryApi.getPaymentStatus(id);
      setPaymentStatus(data);
    } catch (err) {
      console.error('Error loading payment status:', err);
    }
  };

  const loadAuditLog = async () => {
    try {
      const { data } = await api.get(`/vehicles/${id}/audit`);
      setAuditLog(data);
    } catch (err) {
      console.error('Error loading audit log:', err);
    }
  };

  const loadTimeline = async () => {
    try {
      const { data } = await api.get(`/vehicles/${id}/timeline`);
      setTimeline(data.events || []);
    } catch (err) {
      console.error('Error loading timeline:', err);
    }
  };

  useEffect(() => {
    loadVehicle();
    loadVehicleTransactions();
    loadAccounts();
    loadPaymentStatus();
    loadAuditLog();
    loadTimeline();
  }, [id]);

  // Abrir formulario de edición si viene con ?edit=true
  useEffect(() => {
    if (searchParams.get('edit') === 'true' && vehicle) {
      setShowEditForm(true);
    }
  }, [searchParams, vehicle]);

  const reloadAll = () => {
    loadVehicle();
    loadVehicleTransactions();
    loadPaymentStatus();
    loadAuditLog();
  };

  if (!vehicle) return <div className="text-center text-[#6E7681] py-20">Cargando...</div>;

  const m = vehicle.metrics || {};
  const stage = getStage(vehicle.stage);
  const expenses = vehicle.expenses || [];
  const docs = vehicle.documents || [];
  const portals = vehicle.publishedPortals || [];
  // Conteo de la pestaña Tesorería: movimientos + CxP de compra + CxC de venta
  // (un cruce saldado no genera movimiento pero sí su CxP, y debe contarse).
  const treasuryCount = vehicleTransactions.length
    + (paymentStatus?.purchase ? 1 : 0)
    + (paymentStatus?.sale ? 1 : 0);

  const handleDelete = async () => {
    await deleteVehicle(id);
    navigate('/vehicles');
  };

  const handleDeleteDocument = async (docId) => {
    await deleteDocument(docId);
    loadVehicle();
  };

  // Registrar venta con tesorería
  const handleSaleSubmit = async (saleData) => {
    setProcessingAction(true);
    try {
      await vehicleTreasuryApi.registerSale(id, saleData);
      setShowSaleModal(false);
      reloadAll();
    } catch (err) {
      console.error('Error registering sale:', err);
      alert(err.response?.data?.error || 'Error al registrar la venta');
    } finally {
      setProcessingAction(false);
    }
  };

  // Registrar gasto con tesorería
  const handleExpenseTreasurySubmit = async (expenseData) => {
    setProcessingAction(true);
    try {
      await expenseTreasuryApi.createWithTreasury(expenseData);
      setShowExpenseTreasuryModal(false);
      reloadAll();
    } catch (err) {
      console.error('Error creating expense:', err);
      alert(err.response?.data?.error || 'Error al registrar el gasto');
    } finally {
      setProcessingAction(false);
    }
  };

  // Abrir modal para pagar CxP o cobrar CxC
  const openPaymentForPayable = (payable, type) => {
    setPaymentModalConfig({
      type,
      payableId: payable.id,
      totalAmount: parseFloat(payable.totalAmount),
      paidAmount: parseFloat(payable.paidAmount),
      description: payable.description,
    });
    setShowPaymentModal(true);
  };

  // Procesar pago/cobro
  const handlePaymentSubmit = async (paymentData) => {
    if (!paymentModalConfig) return;
    setProcessingAction(true);
    try {
      await payablesApi.addPayment(paymentModalConfig.payableId, paymentData);
      setShowPaymentModal(false);
      setPaymentModalConfig(null);
      reloadAll();
    } catch (err) {
      console.error('Error processing payment:', err);
      alert(err.response?.data?.error || 'Error al procesar el pago');
    } finally {
      setProcessingAction(false);
    }
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
            {!isViewer && (
              <button onClick={() => setShowEditForm(true)} className="btn-ghost">✏ Editar</button>
            )}
            <button onClick={() => navigate(-1)} className="btn-ghost">← Volver</button>
          </div>
        </div>

        {portals.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-3">
            {portals.map(pid => { const p = PORTALS.find(x => x.id === pid); return p ? <span key={pid} className="portal-badge" style={{ background: p.color + '20', color: p.color }}>{p.label}</span> : null; })}
          </div>
        )}

        {vehicle.fromTradeIn && vehicle.sourceVehicle && (
          <button
            type="button"
            onClick={() => navigate(`/vehicles/${vehicle.sourceVehicle.id}`)}
            className="mt-3 w-full text-left p-3 rounded-lg border border-[#BC8CFF]/30 bg-[#BC8CFF]/5 hover:bg-[#BC8CFF]/10 transition-colors"
            data-testid="vehicle-cruce-source-link"
          >
            <div className="text-[11px] text-[#BC8CFF] font-semibold uppercase tracking-wide">⟳ Origen del cruce</div>
            <div className="text-sm text-[#E6EDF3] mt-0.5">
              Recibido en cruce por la venta de <span className="font-mono font-semibold">{vehicle.sourceVehicle.plate}</span>
              <span className="text-[#6E7681] ml-1">→ ver detalle</span>
            </div>
          </button>
        )}

        {vehicle.tradeInsReceived?.length > 0 && (
          <div className="mt-3 space-y-2">
            {vehicle.tradeInsReceived.map(ti => (
              <button
                key={ti.id}
                type="button"
                onClick={() => navigate(`/vehicles/${ti.id}`)}
                className="w-full text-left p-3 rounded-lg border border-[#BC8CFF]/30 bg-[#BC8CFF]/5 hover:bg-[#BC8CFF]/10 transition-colors"
                data-testid={`vehicle-cruce-received-link-${ti.plate}`}
              >
                <div className="text-[11px] text-[#BC8CFF] font-semibold uppercase tracking-wide">⟳ Recibido en cruce</div>
                <div className="text-sm text-[#E6EDF3] mt-0.5">
                  Entregó <span className="font-mono font-semibold">{ti.plate}</span> como parte de pago
                  <span className="text-[#6E7681] ml-1">({ti.stage}) → ver detalle</span>
                </div>
              </button>
            ))}
          </div>
        )}

      </div>

      {/* Tabs */}
      <div className="flex border-b border-border mb-4 overflow-x-auto">
        {[
          { id: 'resumen', label: 'Resumen' },
          { id: 'gastos', label: `Gastos (${expenses.length})` },
          { id: 'tesoreria', label: `Tesoreria (${treasuryCount})` },
          { id: 'financiero', label: 'Financiero' },
          { id: 'documentos', label: `Docs (${docs.length})` },
          { id: 'historial', label: `Historial (${timeline.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} data-testid={`vehicle-tab-${t.id}`}
            className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${tab === t.id ? 'border-accent text-accent' : 'border-transparent text-[#6E7681]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'resumen' && (
        <div className="space-y-4">
          <ProfitSummary vehicle={vehicle} metrics={m} />
          <div className="grid grid-cols-2 gap-4">
          <InfoItem label="Precio de Compra" value={formatCurrency(vehicle.purchasePrice)} />
          <InfoItem label="Fecha de Compra" value={formatDate(vehicle.purchaseDate)} />
          <InfoItem label="Precio Publicado" value={vehicle.listedPrice ? formatCurrency(vehicle.listedPrice) : '—'} />
          {['PUBLICADO', 'DISPONIBLE', 'VENDIDO'].includes(vehicle.stage) && (
            <>
              <InfoItem label="Precio de Venta" value={vehicle.salePrice ? formatCurrency(vehicle.salePrice) : '—'} />
              <InfoItem label="Fecha de Venta" value={formatDate(vehicle.saleDate)} />
            </>
          )}
          <InfoItem label="Participación" value={`${((vehicle.participation || 1) * 100)}%`} />
          <InfoItem
            label="Proveedor"
            value={vehicle.supplier ? vehicle.supplier.name : <span className="text-amber-400">Sin asignar</span>}
          />
          {(vehicle.participation || 1) < 1 && (
            <InfoItem
              label={`Socio (${((vehicle.participation || 1) * 100).toFixed(0)}%)`}
              value={vehicle.partner ? vehicle.partner.name : <span className="text-amber-400">Sin asignar</span>}
            />
          )}
          {vehicle.stage === 'VENDIDO' && (
            <InfoItem
              label="Comprador"
              value={vehicle.buyer ? vehicle.buyer.name : <span className="text-amber-400">Sin asignar</span>}
            />
          )}
          {vehicle.receivedVehicle && <>
            <InfoItem label="Cruce Placa" value={vehicle.receivedVehiclePlate || '—'} />
            <InfoItem label="Valor Cruce" value={formatCurrency(vehicle.receivedVehicleValue)} />
          </>}
          {vehicle.notes && <div className="col-span-2"><InfoItem label="Notas" value={vehicle.notes} /></div>}
          </div>
        </div>
      )}

      {tab === 'gastos' && (
        <div>
          {vehicle.stage === 'VENDIDO' && (
            <div className="mb-4 rounded-lg border border-[#6E7681]/40 bg-[#6E7681]/10 p-3 text-[12px] text-[#8B949E] flex items-center gap-2">
              🔒 Este vehículo está VENDIDO. Los gastos son de solo lectura.
            </div>
          )}
          <div className="flex justify-between mb-4">
            <span className="text-sm font-semibold">Total: {formatCurrency(m.totalExpenses)}</span>
            {!isViewer && (
              <button
                onClick={() => vehicle.stage !== 'VENDIDO' && setShowExpenseTreasuryModal(true)}
                disabled={vehicle.stage === 'VENDIDO'}
                title={vehicle.stage === 'VENDIDO' ? 'Vehículo vendido: no se pueden agregar gastos' : ''}
                className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="open-expense-treasury"
              >
                + Gasto
              </button>
            )}
          </div>
          {expenses.length === 0 ? <p className="text-center text-[#6E7681] py-10">Sin gastos registrados</p> : (
            <div className="space-y-2">
              {expenses.map(e => {
                const cat = getCategory(e.category);
                const locked = vehicle.stage === 'VENDIDO';
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
                          {!locked && !isViewer && (
                            <>
                              <button
                                onClick={() => setEditingExpense({ ...e, vehicle: { id: vehicle.id, plate: vehicle.plate, stage: vehicle.stage } })}
                                className="btn-ghost text-xs px-2.5 py-1"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => setDeletingExpense({ ...e, vehicle: { id: vehicle.id, plate: vehicle.plate, stage: vehicle.stage } })}
                                className="btn-ghost text-[#F85149] text-xs px-2.5 py-1"
                              >
                                🗑
                              </button>
                            </>
                          )}
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

      {tab === 'tesoreria' && (
        <div className="space-y-6">
          {/* Estado de Pagos CxC/CxP */}
          {paymentStatus && (paymentStatus.purchase || paymentStatus.sale) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* CxP - Compra */}
              {paymentStatus.purchase && (
                <div className={`p-4 rounded-lg border ${
                  paymentStatus.purchase.status === 'PAID'
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-red-500/30 bg-red-500/5'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-[#E6EDF3]">Compra (CxP)</h4>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      paymentStatus.purchase.status === 'PAID' ? 'bg-green-500/20 text-green-400' :
                      paymentStatus.purchase.status === 'PARTIAL' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {paymentStatus.purchase.status === 'PAID' ? 'Pagado' :
                       paymentStatus.purchase.status === 'PARTIAL' ? 'Parcial' : 'Pendiente'}
                    </span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#8B949E]">Total:</span>
                      <span>{formatCurrency(paymentStatus.purchase.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B949E]">Pagado:</span>
                      <span className="text-green-400">{formatCurrency(paymentStatus.purchase.paidAmount)}</span>
                    </div>
                    {paymentStatus.purchase.pendingAmount > 0 && (
                      <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1">
                        <span className="text-[#8B949E]">Pendiente:</span>
                        <span className="text-red-400">{formatCurrency(paymentStatus.purchase.pendingAmount)}</span>
                      </div>
                    )}
                  </div>
                  {paymentStatus.purchase.pendingAmount > 0 && (
                    <button
                      onClick={() => openPaymentForPayable(paymentStatus.purchase, 'expense')}
                      className="btn-primary w-full mt-3 text-sm bg-red-600 hover:bg-red-700"
                    >
                      Registrar Pago
                    </button>
                  )}
                </div>
              )}

              {/* CxC - Venta */}
              {paymentStatus.sale && (
                <div className={`p-4 rounded-lg border ${
                  paymentStatus.sale.status === 'PAID'
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-amber-500/30 bg-amber-500/5'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-[#E6EDF3]">Venta (CxC)</h4>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      paymentStatus.sale.status === 'PAID' ? 'bg-green-500/20 text-green-400' :
                      paymentStatus.sale.status === 'PARTIAL' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {paymentStatus.sale.status === 'PAID' ? 'Cobrado' :
                       paymentStatus.sale.status === 'PARTIAL' ? 'Parcial' : 'Pendiente'}
                    </span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#8B949E]">Total:</span>
                      <span>{formatCurrency(paymentStatus.sale.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B949E]">Cobrado:</span>
                      <span className="text-green-400">{formatCurrency(paymentStatus.sale.paidAmount)}</span>
                    </div>
                    {paymentStatus.sale.pendingAmount > 0 && (
                      <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1">
                        <span className="text-[#8B949E]">Pendiente:</span>
                        <span className="text-amber-400">{formatCurrency(paymentStatus.sale.pendingAmount)}</span>
                      </div>
                    )}
                  </div>
                  {paymentStatus.sale.pendingAmount > 0 && (
                    <button
                      onClick={() => openPaymentForPayable(paymentStatus.sale, 'income')}
                      className="btn-primary w-full mt-3 text-sm bg-green-600 hover:bg-green-700"
                    >
                      Registrar Cobro
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Movimientos */}
          <div>
            <div className="text-sm text-[#8B949E] mb-2">Movimientos de tesoreria</div>
            {vehicleTransactions.length === 0 ? (
              <p className="text-center text-[#6E7681] py-6 bg-surface border border-border rounded-lg">
                Sin movimientos registrados
              </p>
            ) : (
              <div className="space-y-2">
                {vehicleTransactions.map(tx => {
                  const isIncome = tx.type === 'INCOME' || tx.type === 'TRANSFER_IN';
                  return (
                    <div key={tx.id} className="flex items-center gap-3 p-3 bg-surface border border-border rounded-lg">
                      <div className={`w-2 h-2 rounded-full ${isIncome ? 'bg-green-400' : 'bg-red-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center gap-2">
                          <div>
                            <div className="text-[13px] font-semibold text-[#E6EDF3]">
                              {tx.description || tx.category}
                            </div>
                            <div className="text-[11px] text-[#6E7681]">
                              {tx.account?.name} · {formatDateTime(tx.createdAt)}
                            </div>
                          </div>
                          <div className={`font-mono font-bold text-sm ${isIncome ? 'text-green-400' : 'text-red-400'}`}>
                            {isIncome ? '+' : '-'}{formatCurrency(tx.amount)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Resumen — Inversión realizada / Pendiente por pagar / Pendiente por cobrar */}
          <InvestmentSummary
            vehicleTransactions={vehicleTransactions}
            paymentStatus={paymentStatus}
            expenses={expenses}
          />
        </div>
      )}

      {tab === 'financiero' && (
        <div className="space-y-4">
          <ProfitSummary vehicle={vehicle} metrics={m} />
          <div className="grid grid-cols-2 gap-3">
            <FinCard label="Valor de Compra" value={formatCurrency(vehicle.purchasePrice)} />
            <FinCard label="Total Gastos Variables" value={formatCurrency(m.totalExpenses)} color="text-[#D29922]" />
            <FinCard label="Gastos Fijos Prorrateados" value={formatCurrency(m.fixedProrated)} sub={`${m.daysInInventory}d`} />
            <FinCard label="COSTO REAL TOTAL" value={formatCurrency(m.realCostWithFixed)} color="text-accent" highlight />
            <FinCard label="Reparaciones" value={formatCurrency(m.repairs)} color="text-[#EF4444]" />
            <FinCard
              label="Comisiones de la venta"
              value={formatCurrency(m.commissionTotal || 0)}
              color="text-[#BC8CFF]"
              sub={
                vehicle.stage === 'VENDIDO' && (m.commissionTotal || 0) > 0
                  ? `Captador: ${formatCurrency(m.commissionCaptador || 0)} · Cerrador: ${formatCurrency(m.commissionCerrador || 0)}`
                  : (m.commissionTotal > 0
                      ? null
                      : (vehicle.stage === 'VENDIDO' ? 'Sin comisiones registradas' : 'Solo al vender se calculan'))
              }
            />
            {(m.commissionTotal || 0) > 0 && (
              <FinCard
                label="Comisiones — estado"
                value={`Pendiente: ${formatCurrency(m.commissionPending || 0)}`}
                color="text-amber-400"
                sub={`Pagado: ${formatCurrency(m.commissionPaid || 0)} (descontado de ganancia)`}
              />
            )}
            <FinCard label="Trámites / Impuestos" value={formatCurrency(m.taxes)} color="text-[#5B8DEF]" />
            {vehicle.partnerId && m.partnerContribution > 0 && (
              <>
                <FinCard label="Aporte Socio" value={formatCurrency(m.partnerContribution)} color="text-[#BC8CFF]" sub={vehicle.partner?.name} />
                <FinCard label="Mi Capital" value={formatCurrency(m.myCapital)} color="text-accent" sub="Descontado de tesorería" />
              </>
            )}
            {vehicle.stage === 'VENDIDO' && (
              <>
                <FinCard label="Valor de Venta" value={formatCurrency(vehicle.salePrice)} color="text-[#3FB950]" />
                <FinCard label="ROI" value={formatPercent(m.roi)} color={m.roi >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]'} />
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'documentos' && (
        <div>
          <div className="flex justify-between mb-4">
            <span className="text-sm font-semibold">Documentos y Fotos</span>
            {!isViewer && (
              <button onClick={() => setShowDocForm(true)} className="btn-primary" data-testid="open-document-form">+ Documento</button>
            )}
          </div>
          {docs.length === 0 ? <p className="text-center text-[#6E7681] py-10">Agrega tarjeta de propiedad, SOAT, peritaje, etc.</p> : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {docs.map(d => (
                <DocumentCard
                  key={d.id}
                  doc={d}
                  onView={setViewerDoc}
                  onDelete={handleDeleteDocument}
                  isViewer={isViewer}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'historial' && (
        <VehicleTimeline events={timeline} />
      )}

      {/* Footer Actions (acciones de escritura: ocultas en modo consulta) */}
      {!isViewer && (
      <div className="flex justify-between items-center mt-6 pt-4 border-t border-border flex-wrap gap-3">
        <div>
          {confirmDel ? (
            <div className="flex gap-2 items-center">
              <span className="text-xs text-[#F85149]">¿Eliminar todo?</span>
              <button onClick={handleDelete} className="btn-danger px-3 py-1">Sí</button>
              <button onClick={() => setConfirmDel(false)} className="btn-ghost text-xs">No</button>
            </div>
          ) : (
            <button
              onClick={() => vehicle.stage !== 'VENDIDO' && setConfirmDel(true)}
              disabled={vehicle.stage === 'VENDIDO'}
              title={vehicle.stage === 'VENDIDO' ? 'Vehículo vendido: no se puede eliminar' : ''}
              className="btn-ghost text-[#F85149] border-[#F8514930] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              🗑 Eliminar
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {vehicle.stage !== 'VENDIDO' && (
            <button
              onClick={() => setShowSaleModal(true)}
              className="btn-primary bg-green-600 hover:bg-green-700"
            >
              💰 Vender
            </button>
          )}
        </div>
      </div>
      )}

      {/* Modals */}
      {showEditForm && <VehicleFormModal vehicle={vehicle} highlightFields={highlightFields} onClose={() => { closeEditForm(); reloadAll(); }} />}
      {showDocForm && <DocumentFormModal vehicleId={id} onClose={() => { setShowDocForm(false); reloadAll(); }} />}
      {viewerDoc && <DocumentViewerModal doc={viewerDoc} onClose={() => setViewerDoc(null)} />}

      {editingExpense && (
        <ExpenseFormModal
          expense={editingExpense}
          onClose={() => { setEditingExpense(null); reloadAll(); }}
        />
      )}
      {deletingExpense && (
        <ExpenseDeleteModal
          expense={deletingExpense}
          onClose={() => setDeletingExpense(null)}
          onConfirm={async (reason) => {
            const { id: expenseId } = await deleteExpense(deletingExpense.id, { reason });
            reloadAll();
            showToast({
              msg: `Gasto eliminado (${deletingExpense.vehicle?.plate || ''})`,
              type: 'danger',
              duration: UNDO_WINDOW_MS,
              action: {
                label: 'Deshacer',
                onClick: async () => {
                  try {
                    await restoreExpense(expenseId);
                    reloadAll();
                    showToast('Gasto restaurado', 'success');
                  } catch (err) {
                    showToast(err.response?.data?.error || 'No se pudo restaurar', 'danger');
                  }
                },
              },
            });
          }}
        />
      )}

      {/* Modal de Venta */}
      <SalePaymentModal
        isOpen={showSaleModal}
        onClose={() => setShowSaleModal(false)}
        onSubmit={handleSaleSubmit}
        vehicle={vehicle}
        loading={processingAction}
      />

      {/* Modal de Gasto con Tesorería */}
      <ExpensePaymentModal
        isOpen={showExpenseTreasuryModal}
        onClose={() => setShowExpenseTreasuryModal(false)}
        onSubmit={handleExpenseTreasurySubmit}
        vehicleId={id}
        vehiclePlate={vehicle.plate}
        loading={processingAction}
      />

      {/* Modal de Pago/Cobro genérico */}
      {paymentModalConfig && (
        <PaymentModal
          isOpen={showPaymentModal}
          onClose={() => {
            setShowPaymentModal(false);
            setPaymentModalConfig(null);
          }}
          onSubmit={handlePaymentSubmit}
          title={paymentModalConfig.type === 'income' ? 'Registrar Cobro' : 'Registrar Pago'}
          type={paymentModalConfig.type}
          totalAmount={paymentModalConfig.totalAmount}
          paidAmount={paymentModalConfig.paidAmount}
          defaultDescription={paymentModalConfig.description}
          loading={processingAction}
        />
      )}
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

function ProfitSummary({ vehicle, metrics }) {
  const m = metrics || {};
  const netProfit = Number(m.netProfit) || 0;
  const myProfit = Number(m.myProfit ?? netProfit) || 0;
  const partnerProfit = Number(m.partnerProfit) || 0;
  const isProjected = !!m.isProjectedProfit;
  const hasPartner = !!vehicle.partnerId && parseFloat(vehicle.participation || 1) < 1;
  const hasRefPrice = m.referencePrice > 0 || vehicle.stage === 'VENDIDO';
  const profitColor = netProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]';
  const myColor = myProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]';

  if (!hasRefPrice) {
    return (
      <div className="p-4 rounded-xl border border-border bg-[#0F1419]">
        <div className="text-[11px] text-[#6E7681] uppercase tracking-wider mb-1">Ganancia Proyectada</div>
        <div className="text-sm text-[#8B949E]">
          Agrega un precio publicado o de venta para ver la ganancia estimada.
        </div>
      </div>
    );
  }

  const label = isProjected ? 'Ganancia Proyectada' : 'Ganancia Neta';
  const pctMine = ((parseFloat(vehicle.participation || 1)) * 100).toFixed(0);
  const pctPartner = (100 - parseFloat(pctMine)).toFixed(0);

  return (
    <div className={`p-4 rounded-xl border ${isProjected ? 'border-accent/20 bg-accent/5' : 'border-[#3FB950]/30 bg-[#3FB950]/5'}`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="text-[10px] text-[#6E7681] uppercase tracking-wider mb-1">
            {label} {isProjected && <span className="text-accent">(estimada)</span>}
          </div>
          <div className={`font-mono font-bold text-2xl ${profitColor}`}>
            {formatCurrency(netProfit)}
          </div>
          {m.roi !== undefined && m.roi !== null && (
            <div className="text-[11px] text-[#8B949E] mt-0.5">ROI: {formatPercent(m.roi)}</div>
          )}
        </div>
        {isProjected && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-accent/20 text-accent font-semibold">
            PROYECTADO
          </span>
        )}
      </div>
      {hasPartner && (
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
          <div>
            <div className="text-[10px] text-[#6E7681] uppercase tracking-wider mb-1">
              Tu Ganancia ({pctMine}%)
            </div>
            <div className={`font-mono font-bold text-lg ${myColor}`}>
              {formatCurrency(myProfit)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#6E7681] uppercase tracking-wider mb-1">
              {vehicle.partner?.name || 'Socio'} ({pctPartner}%)
            </div>
            <div className="font-mono font-bold text-lg text-[#BC8CFF]">
              {formatCurrency(partnerProfit)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Renderiza eventos heterogéneos del vehículo: cambios de identidad, cambios
// de gasto y movimientos de tesorería en un mismo flujo cronológico.
function VehicleTimeline({ events }) {
  if (!events || events.length === 0) {
    return (
      <p className="text-center text-[#6E7681] py-10" data-testid="vehicle-timeline-empty">
        Sin actividad registrada todavía. Los cambios del vehículo, gastos y movimientos quedarán aquí.
      </p>
    );
  }
  return (
    <div className="space-y-2" data-testid="vehicle-timeline">
      {events.map((e) => <VehicleTimelineEvent key={`${e.type}-${e.id}`} event={e} />)}
    </div>
  );
}

const TIMELINE_TYPE_META = {
  VEHICLE_AUDIT: { icon: '📝', color: '#58A6FF', label: 'Vehículo' },
  EXPENSE_AUDIT: { icon: '🧾', color: '#D29922', label: 'Gasto' },
  TRANSACTION: { icon: '💸', color: '#3FB950', label: 'Movimiento' },
};

function VehicleTimelineEvent({ event }) {
  const meta = TIMELINE_TYPE_META[event.type] || { icon: '·', color: '#6E7681', label: event.type };
  const who = event.actor?.name || event.actor?.email || null;
  const when = formatDateTime(event.createdAt);
  const reason = event.metadata?.reason || null;

  let title = event.description || '';
  let detail = null;

  if (event.type === 'VEHICLE_AUDIT') {
    const actionLabel = AUDIT_ACTION_LABELS[event.action] || event.action;
    title = `${actionLabel}: ${event.description}`;
    const changes = event.action === 'STAGE_CHANGE'
      ? [{ field: 'stage', before: event.metadata?.before?.stage, after: event.metadata?.after?.stage }]
      : diffAuditSnapshots(event.metadata?.before, event.metadata?.after);
    if (changes.length > 0) {
      detail = (
        <ul className="mt-2 space-y-1">
          {changes.map((c) => (
            <li key={c.field} className="text-[12px] text-[#8B949E] flex flex-wrap items-baseline gap-1.5">
              <span className="text-[#E6EDF3] font-medium">{AUDIT_FIELD_LABELS[c.field] || c.field}:</span>
              <span className="line-through opacity-70">{fmtAuditValue(c.field, c.before)}</span>
              <span className="text-[#6E7681]">→</span>
              <span className="text-[#E6EDF3]">{fmtAuditValue(c.field, c.after)}</span>
            </li>
          ))}
        </ul>
      );
    }
  } else if (event.type === 'EXPENSE_AUDIT') {
    const map = { CREATE: 'Gasto creado', UPDATE: 'Gasto editado', DELETE: 'Gasto eliminado', RESTORE: 'Gasto restaurado' };
    title = `${map[event.action] || event.action}: ${event.description}`;
    if (event.amount) {
      detail = <div className="mt-1 text-[12px] text-[#8B949E]">Monto: {formatCurrency(event.amount)}</div>;
    }
  } else if (event.type === 'TRANSACTION') {
    const txType = event.metadata?.transactionType;
    const signed = (txType === 'INCOME' || txType === 'TRANSFER_IN') ? '+' : '-';
    const catLabels = {
      VEHICLE_PURCHASE: 'Compra del vehículo',
      VEHICLE_SALE: 'Venta del vehículo',
      VEHICLE_SALE_PARTIAL: 'Abono de venta',
      VEHICLE_EXPENSE: 'Gasto',
      EXPENSE_ADJUSTMENT: 'Ajuste de gasto',
      EXPENSE_REVERSAL: 'Reverso de gasto',
      COMMISSION: 'Comisión',
      OTHER_INCOME: 'Ingreso',
      OTHER_EXPENSE: 'Egreso',
    };
    title = catLabels[event.category] || event.category || 'Movimiento';
    detail = (
      <div className="mt-1 text-[12px] text-[#8B949E] flex flex-wrap gap-x-3 gap-y-0.5">
        <span>{signed}{formatCurrency(event.amount)}</span>
        {event.metadata?.accountName && <span>en {event.metadata.accountName}</span>}
        {event.metadata?.thirdPartyName && <span>· {event.metadata.thirdPartyName}</span>}
        {event.description && <span className="text-[#6E7681]">— {event.description}</span>}
        {event.metadata?.reversesTransactionId && (
          <span className="text-[#6E7681]" title={event.metadata.reversesTransactionId}>
            ← {String(event.metadata.reversesTransactionId).slice(-6)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-3 p-3 bg-surface border border-border rounded-lg"
      data-testid={`timeline-${event.type}`}
    >
      <div className="w-1 self-stretch min-h-[36px] rounded-full shrink-0" style={{ background: meta.color }} />
      <div className="text-base leading-none mt-0.5" aria-hidden>{meta.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <span
            className="text-[12px] font-semibold px-2 py-0.5 rounded"
            style={{ background: meta.color + '20', color: meta.color }}
          >
            {meta.label}
          </span>
          <span className="text-[11px] text-[#6E7681]">
            {who ? `${who} · ` : ''}{when}
          </span>
        </div>
        <div className="mt-1.5 text-[13px] text-[#E6EDF3] font-medium">{title}</div>
        {detail}
        {reason && (
          <div className="mt-1.5 text-[11px] text-[#6E7681] italic">📝 {reason}</div>
        )}
      </div>
    </div>
  );
}

function AuditTimeline({ entries }) {
  if (!entries || entries.length === 0) {
    return (
      <p className="text-center text-[#6E7681] py-10" data-testid="vehicle-audit-empty">
        Sin cambios registrados todavía. Las ediciones y los cambios de etapa quedarán aquí.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {entries.map(e => <AuditEntry key={e.id} entry={e} />)}
    </div>
  );
}

function AuditEntry({ entry }) {
  const color = AUDIT_ACTION_COLORS[entry.action] || '#6E7681';
  const actionLabel = AUDIT_ACTION_LABELS[entry.action] || entry.action;
  const who = entry.user?.name || entry.user?.email || 'Usuario';
  const changes = entry.action === 'STAGE_CHANGE'
    ? [{ field: 'stage', before: entry.before?.stage, after: entry.after?.stage }]
    : diffAuditSnapshots(entry.before, entry.after);

  return (
    <div className="flex items-start gap-3 p-3 bg-surface border border-border rounded-lg" data-testid="vehicle-audit-entry">
      <div className="w-1 self-stretch min-h-[36px] rounded-full shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <span className="text-[12px] font-semibold px-2 py-0.5 rounded" style={{ background: color + '20', color }}>
            {actionLabel}
          </span>
          <span className="text-[11px] text-[#6E7681]">{who} · {formatDateTime(entry.createdAt)}</span>
        </div>
        {changes.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {changes.map(c => (
              <li key={c.field} className="text-[12px] text-[#8B949E] flex flex-wrap items-baseline gap-1.5">
                <span className="text-[#E6EDF3] font-medium">{AUDIT_FIELD_LABELS[c.field] || c.field}:</span>
                <span className="line-through opacity-70">{fmtAuditValue(c.field, c.before)}</span>
                <span className="text-[#6E7681]">→</span>
                <span className="text-[#E6EDF3]">{fmtAuditValue(c.field, c.after)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-1.5 text-[12px] text-[#6E7681]">Sin cambios de campos.</div>
        )}
        {entry.reason && (
          <div className="mt-1.5 text-[11px] text-[#6E7681] italic">📝 {entry.reason}</div>
        )}
      </div>
    </div>
  );
}

function InvestmentSummary({ vehicleTransactions, paymentStatus, expenses }) {
  const invested = vehicleTransactions
    .filter(t => t.type === 'EXPENSE' || t.type === 'TRANSFER_OUT')
    .reduce((s, t) => s + parseFloat(t.amount), 0);

  const purchasePending = parseFloat(paymentStatus?.purchase?.pendingAmount || 0);
  const expensePending = (expenses || [])
    .filter(e => !e.paid)
    .reduce((s, e) => s + parseFloat(e.amount), 0);
  const totalPending = purchasePending + expensePending;

  const salePending = parseFloat(paymentStatus?.sale?.pendingAmount || 0);

  return (
    <div className="p-4 bg-surface-hover rounded-lg">
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-xs text-[#8B949E] mb-1">Inversión realizada</div>
          <div className="text-lg font-bold text-accent">{formatCurrency(invested)}</div>
          <div className="text-[10px] text-[#6E7681] mt-0.5">Ya salió de tesorería</div>
        </div>
        <div>
          <div className="text-xs text-[#8B949E] mb-1">Pendiente por pagar</div>
          <div className="text-lg font-bold text-red-400">{formatCurrency(totalPending)}</div>
          <div className="text-[10px] text-[#6E7681] mt-0.5">
            {purchasePending > 0 && `Compra: ${formatCurrency(purchasePending)}`}
            {purchasePending > 0 && expensePending > 0 && ' · '}
            {expensePending > 0 && `Gastos: ${formatCurrency(expensePending)}`}
            {totalPending === 0 && 'Todo al día'}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#8B949E] mb-1">Pendiente por cobrar</div>
          <div className="text-lg font-bold text-amber-400">{formatCurrency(salePending)}</div>
          <div className="text-[10px] text-[#6E7681] mt-0.5">
            {salePending > 0 ? 'Venta financiada' : 'Sin saldos pendientes'}
          </div>
        </div>
      </div>
    </div>
  );
}
