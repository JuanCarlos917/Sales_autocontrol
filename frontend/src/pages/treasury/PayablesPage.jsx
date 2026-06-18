// ═══════════════════════════════════════════════════════════════
// PayablesPage — Cuentas por Cobrar y Pagar con tarjetas de vehículos
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { payablesApi } from '@/lib/payablesApi';
import { formatCurrency, formatDate } from '@/lib/constants';
import { ClipboardList, ArrowDownLeft, ArrowUpRight, Briefcase, CheckCircle2, Car, HandCoins, DollarSign, User, Calendar } from 'lucide-react';
import { PaymentModal } from '@/components/treasury';
import { useAuth } from '@/contexts/AuthContext';

const STATUS_CONFIG = {
  PENDING: { label: 'Pendiente', color: 'bg-amber-500/20 text-amber-400' },
  PARTIAL: { label: 'Parcial', color: 'bg-blue-500/20 text-blue-400' },
  PAID: { label: 'Pagado', color: 'bg-green-500/20 text-green-400' },
  CANCELLED: { label: 'Cancelado', color: 'bg-gray-500/20 text-gray-400' },
};

export default function PayablesPage() {
  const { isViewer } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [payables, setPayables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(searchParams.get('type') || 'all');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPayable, setSelectedPayable] = useState(null);
  const [processingPayment, setProcessingPayment] = useState(false);

  // Cargar TODAS las CxPs una sola vez. El filtrado por tab (Receivable/Payable/
  // Commission) se hace en cliente — así los counters del header y los badges de
  // las pestañas siempre reflejan el total real sin esperar refetch al cambiar tab.
  useEffect(() => {
    loadPayables();
  }, []);

  useEffect(() => {
    const type = searchParams.get('type');
    if (type && type !== filter) {
      setFilter(type);
    }
  }, [searchParams]);

  const loadPayables = async () => {
    setLoading(true);
    try {
      const { data } = await payablesApi.getAll({});
      const pendingPayables = (data || []).filter(p => p.status === 'PENDING' || p.status === 'PARTIAL');
      setPayables(pendingPayables);
    } catch (err) {
      console.error('Error loading payables:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
    if (newFilter === 'all') {
      searchParams.delete('type');
    } else {
      searchParams.set('type', newFilter);
    }
    setSearchParams(searchParams);
  };

  const handleVehicleClick = (payable) => {
    if (payable.vehicleId) {
      navigate(`/vehicles/${payable.vehicleId}?tab=tesoreria`);
    }
  };

  const handlePaymentClick = (e, payable) => {
    e.stopPropagation();
    setSelectedPayable(payable);
    setShowPaymentModal(true);
  };

  const handlePaymentSubmit = async (paymentData) => {
    if (!selectedPayable) return;
    setProcessingPayment(true);
    try {
      await payablesApi.addPayment(selectedPayable.id, paymentData);
      setShowPaymentModal(false);
      setSelectedPayable(null);
      loadPayables();
    } catch (err) {
      console.error('Error processing payment:', err);
      alert(err.response?.data?.error || 'Error al procesar el pago');
    } finally {
      setProcessingPayment(false);
    }
  };

  const isOverdue = (dueDate) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  const getDaysInfo = (dueDate) => {
    if (!dueDate) return null;
    const days = Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (days < 0) return { text: `Vencido hace ${Math.abs(days)} dia${Math.abs(days) !== 1 ? 's' : ''}`, isOverdue: true };
    if (days === 0) return { text: 'Vence hoy', isOverdue: true };
    return { text: `Vence en ${days} dia${days !== 1 ? 's' : ''}`, isOverdue: false };
  };

  const tabs = [
    { id: 'all', label: 'Todas', icon: ClipboardList },
    { id: 'receivable', label: 'Por Cobrar (CxC)', icon: ArrowDownLeft, color: 'text-green-400' },
    { id: 'payable', label: 'Por Pagar (CxP)', icon: ArrowUpRight, color: 'text-red-400' },
    { id: 'commission', label: 'Comisiones', icon: Briefcase, color: 'text-[#BC8CFF]' },
  ];

  const pendingDelta = (p) => parseFloat(p.totalAmount) - parseFloat(p.paidAmount);
  const commissionsByRole = (role) => payables
    .filter(p => p.type === 'COMMISSION' && p.saleParticipant?.role === role)
    .reduce((s, p) => s + pendingDelta(p), 0);

  const totals = {
    receivable: payables.filter(p => p.type === 'RECEIVABLE').reduce((s, p) => s + pendingDelta(p), 0),
    payable: payables.filter(p => p.type === 'PAYABLE').reduce((s, p) => s + pendingDelta(p), 0),
    commission: payables.filter(p => p.type === 'COMMISSION').reduce((s, p) => s + pendingDelta(p), 0),
    commissionCaptador: commissionsByRole('CAPTADOR'),
    commissionCerrador: commissionsByRole('CERRADOR'),
  };

  // Lista visible según pestaña activa (filtrado client-side, instantáneo)
  const visiblePayables = filter === 'all' ? payables : payables.filter(p => {
    if (filter === 'receivable') return p.type === 'RECEIVABLE';
    if (filter === 'payable') return p.type === 'PAYABLE';
    if (filter === 'commission') return p.type === 'COMMISSION';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/treasury" className="text-[#6E7681] hover:text-accent transition-colors">
              ← Tesoreria
            </Link>
          </div>
          <h2 className="text-xl font-bold text-[#E6EDF3] mt-2">Cuentas Pendientes</h2>
          <p className="text-sm text-[#6E7681] mt-1">
            Gestiona cobros y pagos asociados a vehículos
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <div className="text-[#6E7681]">Por cobrar</div>
            <div className="font-mono font-bold text-green-400">{formatCurrency(totals.receivable)}</div>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="text-right">
            <div className="text-[#6E7681]">Por pagar</div>
            <div className="font-mono font-bold text-red-400">{formatCurrency(totals.payable)}</div>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="text-right">
            <div className="text-[#6E7681]">Comisiones</div>
            <div className="font-mono font-bold text-[#BC8CFF]" data-testid="commissions-total">{formatCurrency(totals.commission)}</div>
            {totals.commission > 0 && (
              <div className="mt-1 text-[10px] text-[#8B949E] leading-tight">
                <div data-testid="commissions-captador">Captador: <span className="font-mono text-[#BC8CFF]/80">{formatCurrency(totals.commissionCaptador)}</span></div>
                <div data-testid="commissions-cerrador">Cerrador: <span className="font-mono text-[#BC8CFF]/80">{formatCurrency(totals.commissionCerrador)}</span></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleFilterChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
              filter === tab.id
                ? 'bg-accent/20 text-accent'
                : 'text-[#6E7681] hover:bg-surface-hover'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className={filter === tab.id ? '' : tab.color}>{tab.label}</span>
            {tab.id !== 'all' && (
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${
                filter === tab.id ? 'bg-accent/30' : 'bg-surface-hover'
              }`}>
                {payables.filter(p => {
                  if (tab.id === 'receivable') return p.type === 'RECEIVABLE';
                  if (tab.id === 'payable') return p.type === 'PAYABLE';
                  if (tab.id === 'commission') return p.type === 'COMMISSION';
                  return false;
                }).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Cards Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-6 bg-surface-hover rounded w-24 mb-3" />
              <div className="h-4 bg-surface-hover rounded w-32 mb-2" />
              <div className="h-4 bg-surface-hover rounded w-20" />
            </div>
          ))}
        </div>
      ) : visiblePayables.length === 0 ? (
        <div className="card p-12 text-center">
          <CheckCircle2 className="w-11 h-11 mx-auto mb-4 text-green-400" />
          <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">Sin cuentas pendientes</h3>
          <p className="text-sm text-[#6E7681]">
            {filter === 'receivable' && 'No hay cuentas por cobrar en este momento'}
            {filter === 'payable' && 'No hay cuentas por pagar en este momento'}
            {filter === 'commission' && 'No hay comisiones pendientes en este momento'}
            {filter === 'all' && 'Todas las cuentas están al día'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Agrupar CxPs COMMISSION por vehículo (1 card por venta con desglose por rol) */}
          {(() => {
            const ROLE_LABEL = { CAPTADOR: 'Captador', CERRADOR: 'Cerrador', OTHER: 'Otro' };
            const ROLE_ORDER = { CAPTADOR: 0, CERRADOR: 1, OTHER: 2 };
            const groupsByVehicle = new Map();
            for (const p of visiblePayables) {
              if (p.type === 'COMMISSION' && p.vehicleId) {
                if (!groupsByVehicle.has(p.vehicleId)) groupsByVehicle.set(p.vehicleId, []);
                groupsByVehicle.get(p.vehicleId).push(p);
              }
            }
            return Array.from(groupsByVehicle.entries()).map(([vehicleId, group]) => {
              const vehicle = group[0].vehicle;
              const totalAmount = group.reduce((s, p) => s + parseFloat(p.totalAmount), 0);
              const sorted = [...group].sort((a, b) =>
                (ROLE_ORDER[a.saleParticipant?.role] ?? 99) - (ROLE_ORDER[b.saleParticipant?.role] ?? 99)
              );
              return (
                <div
                  key={`commission-group-${vehicleId}`}
                  className="card p-4 transition-all border-[#BC8CFF]/20"
                  data-testid={`commission-group-${vehicle?.plate || vehicleId}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-[#BC8CFF]" />
                      <span className="text-xs px-2 py-0.5 rounded font-semibold bg-[#BC8CFF]/20 text-[#BC8CFF]">
                        Comisión venta
                      </span>
                    </div>
                  </div>

                  {vehicle && (
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Car className="w-5 h-5 text-[#6E7681]" />
                        <span className="plate-text text-lg">{vehicle.plate}</span>
                      </div>
                      <div className="text-sm text-[#8B949E]">
                        {vehicle.brand} {vehicle.model} {vehicle.year}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 mb-3">
                    {sorted.map(p => {
                      const role = p.saleParticipant?.role || 'OTHER';
                      const sharePct = p.saleParticipant?.sharePct ? Number(p.saleParticipant.sharePct) : null;
                      const pending = parseFloat(p.totalAmount) - parseFloat(p.paidAmount);
                      const status = STATUS_CONFIG[p.status] || STATUS_CONFIG.PENDING;
                      const isPaid = p.status === 'PAID' || p.status === 'CANCELLED';
                      const roleLabel = ROLE_LABEL[role] || role;
                      return (
                        <div
                          key={p.id}
                          className="bg-[#0F1419] rounded-lg p-3 border border-border"
                          data-testid={`commission-role-${role.toLowerCase()}-${vehicle?.plate || vehicleId}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-[#BC8CFF]/10 text-[#BC8CFF] border border-[#BC8CFF]/30">
                              {role}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${status.color}`}>
                              {status.label}
                            </span>
                          </div>
                          <div className="flex items-end justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[11px] text-[#6E7681]">
                                {roleLabel}{sharePct != null ? ` (${sharePct}%)` : ''}
                              </div>
                              <div className="text-base font-mono font-bold text-[#BC8CFF]">
                                {formatCurrency(pending)}
                              </div>
                              {p.status === 'PARTIAL' && (
                                <div className="text-[10px] font-mono text-[#8B949E] mt-0.5">
                                  Pagado {formatCurrency(p.paidAmount)} / {formatCurrency(p.totalAmount)}
                                </div>
                              )}
                            </div>
                            {!isPaid && !isViewer && (
                              <button
                                onClick={(e) => handlePaymentClick(e, p)}
                                data-testid={`payable-pay-${p.id}`}
                                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors whitespace-nowrap"
                              >
                                <span className="inline-flex items-center gap-1"><HandCoins className="w-3.5 h-3.5" /> Pagar</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <span className="text-xs text-[#6E7681]">Total comisión venta</span>
                    <span className="text-sm font-mono font-bold text-[#BC8CFF]">{formatCurrency(totalAmount)}</span>
                  </div>

                  {vehicle && (
                    <button
                      onClick={() => navigate(`/vehicles/${vehicleId}`)}
                      className="mt-3 w-full py-2 rounded-lg text-xs font-semibold bg-surface-hover text-[#E6EDF3] hover:bg-accent/20 hover:text-accent transition-colors"
                    >
                      Ver vehículo →
                    </button>
                  )}
                </div>
              );
            });
          })()}

          {/* CxC y CxP regulares (no-COMMISSION) usan el layout original */}
          {visiblePayables.filter(p => !(p.type === 'COMMISSION' && p.vehicleId)).map(payable => {
            const pending = parseFloat(payable.totalAmount) - parseFloat(payable.paidAmount);
            const isReceivable = payable.type === 'RECEIVABLE';
            const isCommission = payable.type === 'COMMISSION';
            const commissionRole = payable.saleParticipant?.role;
            const overdue = isOverdue(payable.dueDate) && payable.status !== 'PAID';
            const daysInfo = getDaysInfo(payable.dueDate);
            const hasVehicle = !!payable.vehicleId;
            const statusConfig = STATUS_CONFIG[payable.status] || STATUS_CONFIG.PENDING;

            return (
              <div
                key={payable.id}
                onClick={() => handleVehicleClick(payable)}
                className={`card p-4 transition-all ${
                  hasVehicle ? 'cursor-pointer hover:border-accent/30 hover:-translate-y-0.5' : ''
                } ${overdue ? (isReceivable ? 'border-amber-500/40' : 'border-red-500/40') : ''}`}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`${isReceivable ? 'text-green-400' : isCommission ? 'text-[#BC8CFF]' : 'text-red-400'}`}>
                      {isReceivable ? <ArrowDownLeft className="w-5 h-5" /> : isCommission ? <Briefcase className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                      isReceivable
                        ? 'bg-green-500/20 text-green-400'
                        : isCommission
                          ? 'bg-[#BC8CFF]/20 text-[#BC8CFF]'
                          : 'bg-red-500/20 text-red-400'
                    }`}>
                      {isReceivable ? 'CxC' : isCommission ? 'Comisión' : 'CxP'}
                    </span>
                    {isCommission && commissionRole && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-[#BC8CFF]/10 text-[#BC8CFF] border border-[#BC8CFF]/30">
                        {commissionRole}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusConfig.color}`}>
                    {statusConfig.label}
                  </span>
                </div>

                {/* Vehicle Info */}
                {hasVehicle && payable.vehicle ? (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Car className="w-5 h-5 text-[#6E7681]" />
                      <span className="plate-text text-lg">{payable.vehicle.plate}</span>
                    </div>
                    <div className="text-sm text-[#8B949E]">
                      {payable.vehicle.brand} {payable.vehicle.model} {payable.vehicle.year}
                    </div>
                  </div>
                ) : (
                  <div className="mb-3">
                    <div className="text-sm text-[#E6EDF3]">
                      {payable.description || 'Sin descripción'}
                    </div>
                    {payable.thirdParty && (
                      <div className="text-xs text-[#6E7681] mt-1">
                        <span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5" /> {payable.thirdParty.name}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Amount */}
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <div className="text-xs text-[#6E7681]">Pendiente</div>
                    <div className={`text-xl font-mono font-bold ${
                      isReceivable ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {formatCurrency(pending)}
                    </div>
                  </div>
                  {payable.status === 'PARTIAL' && (
                    <div className="text-right">
                      <div className="text-xs text-[#6E7681]">Pagado</div>
                      <div className="text-sm font-mono text-[#8B949E]">
                        {formatCurrency(payable.paidAmount)} / {formatCurrency(payable.totalAmount)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Due Date */}
                {daysInfo && (
                  <div className={`text-xs mb-3 ${
                    daysInfo.isOverdue ? (isReceivable ? 'text-amber-400' : 'text-red-400') : 'text-[#6E7681]'
                  }`}>
                    <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {daysInfo.text}</span>
                    {payable.dueDate && <span className="text-[#6E7681] ml-1">({formatDate(payable.dueDate)})</span>}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-3 border-t border-border">
                  {payable.status !== 'PAID' && payable.status !== 'CANCELLED' && !isViewer && (
                    <button
                      onClick={(e) => handlePaymentClick(e, payable)}
                      data-testid={`payable-pay-${payable.id}`}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                        isReceivable
                          ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                          : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      }`}
                    >
                      <span className="inline-flex items-center justify-center gap-1.5">{isReceivable ? <><DollarSign className="w-3.5 h-3.5" /> Cobrar</> : <><HandCoins className="w-3.5 h-3.5" /> Pagar</>}</span>
                    </button>
                  )}
                  {hasVehicle && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleVehicleClick(payable);
                      }}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-surface-hover text-[#E6EDF3] hover:bg-accent/20 hover:text-accent transition-colors"
                    >
                      Ver vehículo →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Payment Modal */}
      {selectedPayable && (
        <PaymentModal
          isOpen={showPaymentModal}
          onClose={() => {
            setShowPaymentModal(false);
            setSelectedPayable(null);
          }}
          onSubmit={handlePaymentSubmit}
          title={selectedPayable.type === 'RECEIVABLE' ? 'Registrar Cobro' : 'Registrar Pago'}
          type={selectedPayable.type === 'RECEIVABLE' ? 'income' : 'expense'}
          totalAmount={parseFloat(selectedPayable.totalAmount)}
          paidAmount={parseFloat(selectedPayable.paidAmount)}
          defaultDescription={selectedPayable.description || `${selectedPayable.vehicle?.plate || ''}`}
          loading={processingPayment}
        />
      )}
    </div>
  );
}
