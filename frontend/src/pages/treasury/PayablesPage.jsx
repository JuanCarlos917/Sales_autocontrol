// ═══════════════════════════════════════════════════════════════
// PayablesPage — Cuentas por Cobrar y Pagar con tarjetas de vehículos
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { payablesApi } from '@/lib/payablesApi';
import { formatCurrency, formatDate } from '@/lib/constants';
import { PaymentModal } from '@/components/treasury';

const STATUS_CONFIG = {
  PENDING: { label: 'Pendiente', color: 'bg-amber-500/20 text-amber-400' },
  PARTIAL: { label: 'Parcial', color: 'bg-blue-500/20 text-blue-400' },
  PAID: { label: 'Pagado', color: 'bg-green-500/20 text-green-400' },
  CANCELLED: { label: 'Cancelado', color: 'bg-gray-500/20 text-gray-400' },
};

export default function PayablesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [payables, setPayables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(searchParams.get('type') || 'all');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPayable, setSelectedPayable] = useState(null);
  const [processingPayment, setProcessingPayment] = useState(false);

  useEffect(() => {
    loadPayables();
  }, [filter]);

  useEffect(() => {
    const type = searchParams.get('type');
    if (type && type !== filter) {
      setFilter(type);
    }
  }, [searchParams]);

  const loadPayables = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter === 'receivable') params.type = 'RECEIVABLE';
      if (filter === 'payable') params.type = 'PAYABLE';

      const { data } = await payablesApi.getAll(params);
      // Filtrar solo pendientes y parciales en el frontend
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
    { id: 'all', label: 'Todas', icon: '📋' },
    { id: 'receivable', label: 'Por Cobrar (CxC)', icon: '📥', color: 'text-green-400' },
    { id: 'payable', label: 'Por Pagar (CxP)', icon: '📤', color: 'text-red-400' },
  ];

  const totals = {
    receivable: payables.filter(p => p.type === 'RECEIVABLE').reduce((s, p) => s + parseFloat(p.totalAmount) - parseFloat(p.paidAmount), 0),
    payable: payables.filter(p => p.type === 'PAYABLE').reduce((s, p) => s + parseFloat(p.totalAmount) - parseFloat(p.paidAmount), 0),
  };

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
            <span>{tab.icon}</span>
            <span className={filter === tab.id ? '' : tab.color}>{tab.label}</span>
            {tab.id !== 'all' && (
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${
                filter === tab.id ? 'bg-accent/30' : 'bg-surface-hover'
              }`}>
                {payables.filter(p =>
                  tab.id === 'receivable' ? p.type === 'RECEIVABLE' : p.type === 'PAYABLE'
                ).length}
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
      ) : payables.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">Sin cuentas pendientes</h3>
          <p className="text-sm text-[#6E7681]">
            {filter === 'receivable' && 'No hay cuentas por cobrar en este momento'}
            {filter === 'payable' && 'No hay cuentas por pagar en este momento'}
            {filter === 'all' && 'Todas las cuentas están al día'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {payables.map(payable => {
            const pending = parseFloat(payable.totalAmount) - parseFloat(payable.paidAmount);
            const isReceivable = payable.type === 'RECEIVABLE';
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
                  <div className="flex items-center gap-2">
                    <span className={`text-lg ${isReceivable ? 'text-green-400' : 'text-red-400'}`}>
                      {isReceivable ? '📥' : '📤'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                      isReceivable ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {isReceivable ? 'CxC' : 'CxP'}
                    </span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusConfig.color}`}>
                    {statusConfig.label}
                  </span>
                </div>

                {/* Vehicle Info */}
                {hasVehicle && payable.vehicle ? (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">🚗</span>
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
                        👤 {payable.thirdParty.name}
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
                    📅 {daysInfo.text}
                    {payable.dueDate && <span className="text-[#6E7681] ml-1">({formatDate(payable.dueDate)})</span>}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-3 border-t border-border">
                  {payable.status !== 'PAID' && payable.status !== 'CANCELLED' && (
                    <button
                      onClick={(e) => handlePaymentClick(e, payable)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                        isReceivable
                          ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                          : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      }`}
                    >
                      {isReceivable ? '💰 Cobrar' : '💸 Pagar'}
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
