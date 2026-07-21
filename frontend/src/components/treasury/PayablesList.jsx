// ═══════════════════════════════════════════════════════════════
// PayablesList — Lista de Cuentas por Cobrar / Pagar
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/constants';
import PaymentModal from './PaymentModal';

const STATUS_COLORS = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  PARTIAL: 'bg-blue-500/20 text-blue-400',
  PAID: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-gray-500/20 text-gray-400',
};

const STATUS_LABELS = {
  PENDING: 'Pendiente',
  PARTIAL: 'Parcial',
  PAID: 'Pagado',
  CANCELLED: 'Cancelado',
};

export default function PayablesList({
  payables = [],
  type = 'PAYABLE', // 'PAYABLE' | 'RECEIVABLE'
  onPayment,
  loading = false,
  compact = false,
}) {
  const [selectedPayable, setSelectedPayable] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);

  const isReceivable = type === 'RECEIVABLE';
  const title = isReceivable ? 'Cuentas por Cobrar' : 'Cuentas por Pagar';
  const emptyMessage = isReceivable ? 'No hay cuentas por cobrar' : 'No hay cuentas por pagar';

  const handleOpenPayment = (payable) => {
    setSelectedPayable(payable);
    setShowPaymentModal(true);
  };

  const handlePaymentSubmit = async (paymentData) => {
    if (!selectedPayable || !onPayment) return;
    setProcessingPayment(true);
    try {
      await onPayment(selectedPayable.id, paymentData);
      setShowPaymentModal(false);
      setSelectedPayable(null);
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

  if (loading) {
    return (
      <div className="card">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-surface-hover rounded w-1/3"></div>
          <div className="h-10 bg-surface-hover rounded"></div>
          <div className="h-10 bg-surface-hover rounded"></div>
        </div>
      </div>
    );
  }

  if (compact) {
    // Vista compacta para widgets
    return (
      <div className="space-y-2">
        {payables.length === 0 ? (
          <p className="text-sm text-[#8B949E] text-center py-2">{emptyMessage}</p>
        ) : (
          payables.slice(0, 5).map((p) => {
            const pending = parseFloat(p.totalAmount) - parseFloat(p.paidAmount);
            const overdue = isOverdue(p.dueDate) && p.status !== 'PAID';
            return (
              <div
                key={p.id}
                className={`flex items-center justify-between p-2 rounded-lg border ${
                  overdue ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-surface-hover'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#E6EDF3] truncate">
                    {p.vehicle?.plate || p.description || 'Sin descripcion'}
                  </p>
                  <p className="text-xs text-[#8B949E]">
                    {p.thirdParty?.name || 'Sin tercero'}
                    {p.dueDate && ` • Vence: ${formatDate(p.dueDate)}`}
                  </p>
                </div>
                <div className="text-right ml-2">
                  <p className={`text-sm font-semibold ${isReceivable ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(pending)}
                  </p>
                  {p.status !== 'PAID' && onPayment && (
                    <button
                      onClick={() => handleOpenPayment(p)}
                      className="text-xs text-accent hover:underline"
                    >
                      {isReceivable ? 'Cobrar' : 'Pagar'}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }

  // Vista completa
  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold text-[#E6EDF3]">{title}</h3>
      </div>

      {payables.length === 0 ? (
        <div className="p-6 text-center text-[#8B949E]">{emptyMessage}</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-surface-hover text-[#8B949E]">
            <tr>
              <th className="text-left p-3">Descripcion</th>
              <th className="text-left p-3 hidden md:table-cell">Tercero</th>
              <th className="text-left p-3 hidden lg:table-cell">Vencimiento</th>
              <th className="text-center p-3">Estado</th>
              <th className="text-right p-3">Total</th>
              <th className="text-right p-3">Pendiente</th>
              <th className="text-center p-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {payables.map((p) => {
              const pending = parseFloat(p.totalAmount) - parseFloat(p.paidAmount);
              const overdue = isOverdue(p.dueDate) && p.status !== 'PAID';
              return (
                <tr
                  key={p.id}
                  className={`border-t border-border hover:bg-surface-hover ${
                    overdue ? 'bg-red-500/5' : ''
                  }`}
                >
                  <td className="p-3">
                    <div>
                      <p className="text-[#E6EDF3]">
                        {p.vehicle?.plate && (
                          <span className="font-mono text-accent mr-2">{p.vehicle.plate}</span>
                        )}
                        {p.description || 'Sin descripcion'}
                      </p>
                      {p.vehicle && (
                        <p className="text-xs text-[#8B949E]">
                          {p.vehicle.brand} {p.vehicle.model}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="p-3 hidden md:table-cell text-[#8B949E]">
                    {p.thirdParty?.name || '-'}
                  </td>
                  <td className={`p-3 hidden lg:table-cell ${overdue ? 'text-red-400' : 'text-[#8B949E]'}`}>
                    {p.dueDate ? formatDate(p.dueDate) : '-'}
                    {overdue && <span className="ml-1 text-xs">(Vencido)</span>}
                  </td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[p.status]}`}>
                      {STATUS_LABELS[p.status]}
                    </span>
                  </td>
                  <td className="p-3 text-right text-[#E6EDF3]">
                    {formatCurrency(p.totalAmount)}
                  </td>
                  <td className={`p-3 text-right font-semibold ${
                    pending > 0 ? (isReceivable ? 'text-green-400' : 'text-red-400') : 'text-[#8B949E]'
                  }`}>
                    {formatCurrency(pending)}
                  </td>
                  <td className="p-3 text-center">
                    {p.status !== 'PAID' && p.status !== 'CANCELLED' && onPayment && (
                      <button
                        onClick={() => handleOpenPayment(p)}
                        className={`text-xs px-2 py-1 rounded ${
                          isReceivable
                            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                            : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                        }`}
                      >
                        {isReceivable ? 'Cobrar' : 'Pagar'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Modal de pago */}
      {selectedPayable && (
        <PaymentModal
          isOpen={showPaymentModal}
          onClose={() => {
            setShowPaymentModal(false);
            setSelectedPayable(null);
          }}
          onSubmit={handlePaymentSubmit}
          title={isReceivable ? 'Registrar Cobro' : 'Registrar Pago'}
          type={isReceivable ? 'income' : 'expense'}
          totalAmount={parseFloat(selectedPayable.totalAmount)}
          paidAmount={parseFloat(selectedPayable.paidAmount)}
          defaultDescription={selectedPayable.description || ''}
          payableType={selectedPayable.type}
          thirdPartyId={selectedPayable.thirdPartyId}
          loading={processingPayment}
        />
      )}
    </div>
  );
}
