import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '@/contexts/AppContext';
import api from '@/lib/api';
import { STAGES, EXPENSE_CATEGORIES, PORTALS, DOC_TYPES, formatCurrency, formatPercent, formatDate, getStage, getCategory } from '@/lib/constants';
import VehicleFormModal from '@/components/vehicles/VehicleFormModal';
import ExpenseFormModal from '@/components/expenses/ExpenseFormModal';
import DocumentFormModal from '@/components/documents/DocumentFormModal';
import { transactionsApi, accountsApi } from '@/lib/treasuryApi';
import { vehicleTreasuryApi, payablesApi, expenseTreasuryApi } from '@/lib/payablesApi';
import { SalePaymentModal, PaymentModal, ExpensePaymentModal } from '@/components/treasury';

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

  useEffect(() => {
    loadVehicle();
    loadVehicleTransactions();
    loadAccounts();
    loadPaymentStatus();
  }, [id]);

  const reloadAll = () => {
    loadVehicle();
    loadVehicleTransactions();
    loadPaymentStatus();
  };

  if (!vehicle) return <div className="text-center text-[#6E7681] py-20">Cargando...</div>;

  const m = vehicle.metrics || {};
  const stage = getStage(vehicle.stage);
  const stageIdx = STAGES.findIndex(s => s.id === vehicle.stage);
  const expenses = vehicle.expenses || [];
  const docs = vehicle.documents || [];
  const portals = vehicle.publishedPortals || [];

  const handleMove = async (newStage) => {
    // Si va a VENDIDO, abrir modal de venta
    if (newStage === 'VENDIDO' && vehicle.stage !== 'VENDIDO') {
      setShowSaleModal(true);
      return;
    }
    await moveVehicle(id, newStage);
    reloadAll();
  };

  const handleDelete = async () => {
    await deleteVehicle(id);
    navigate('/vehicles');
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
      <div className="flex border-b border-border mb-4 overflow-x-auto">
        {[
          { id: 'resumen', label: 'Resumen' },
          { id: 'gastos', label: `Gastos (${expenses.length})` },
          { id: 'tesoreria', label: `Tesoreria (${vehicleTransactions.length})` },
          { id: 'financiero', label: 'Financiero' },
          { id: 'documentos', label: `Docs (${docs.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${tab === t.id ? 'border-accent text-accent' : 'border-transparent text-[#6E7681]'}`}>
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
            <div className="flex gap-2">
              <button onClick={() => setShowExpenseForm(true)} className="btn-ghost text-sm">+ Simple</button>
              <button onClick={() => setShowExpenseTreasuryModal(true)} className="btn-primary text-sm">+ Con Tesoreria</button>
            </div>
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
                              {tx.account?.name} · {formatDate(tx.date)}
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

          {/* Resumen */}
          {vehicleTransactions.length > 0 && (
            <div className="p-4 bg-surface-hover rounded-lg">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-xs text-[#8B949E] mb-1">Total Pagado</div>
                  <div className="text-lg font-bold text-red-400">
                    {formatCurrency(vehicleTransactions.filter(t => t.type === 'EXPENSE' || t.type === 'TRANSFER_OUT').reduce((s, t) => s + parseFloat(t.amount), 0))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#8B949E] mb-1">Total Cobrado</div>
                  <div className="text-lg font-bold text-green-400">
                    {formatCurrency(vehicleTransactions.filter(t => t.type === 'INCOME' || t.type === 'TRANSFER_IN').reduce((s, t) => s + parseFloat(t.amount), 0))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#8B949E] mb-1">Balance</div>
                  <div className="text-lg font-bold text-accent">
                    {formatCurrency(
                      vehicleTransactions.filter(t => t.type === 'INCOME' || t.type === 'TRANSFER_IN').reduce((s, t) => s + parseFloat(t.amount), 0) -
                      vehicleTransactions.filter(t => t.type === 'EXPENSE' || t.type === 'TRANSFER_OUT').reduce((s, t) => s + parseFloat(t.amount), 0)
                    )}
                  </div>
                </div>
              </div>
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
          {/* Botón de venta destacado para vehículos disponibles */}
          {vehicle.stage !== 'VENDIDO' && (
            <button
              onClick={() => setShowSaleModal(true)}
              className="btn-primary bg-green-600 hover:bg-green-700"
            >
              💰 Vender
            </button>
          )}
          {stageIdx < STAGES.length - 1 && vehicle.stage !== 'DISPONIBLE' && (
            <button onClick={() => handleMove(STAGES[stageIdx + 1].id)} className="btn-primary" style={{ background: STAGES[stageIdx + 1].color }}>
              {STAGES[stageIdx + 1].label} →
            </button>
          )}
        </div>
      </div>

      {/* Modals */}
      {showEditForm && <VehicleFormModal vehicle={vehicle} onClose={() => { setShowEditForm(false); reloadAll(); }} />}
      {showExpenseForm && <ExpenseFormModal vehicleId={id} onClose={() => { setShowExpenseForm(false); reloadAll(); }} />}
      {showDocForm && <DocumentFormModal vehicleId={id} onClose={() => { setShowDocForm(false); reloadAll(); }} />}

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
