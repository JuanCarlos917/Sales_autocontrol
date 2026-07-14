// ═══════════════════════════════════════════════════════════════
// Commissions Page — comisiones por carro vendido (cascada + pago por rol)
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { commissionsApi, payablesApi } from '@/lib/payablesApi';
import { formatCurrency, formatDate } from '@/lib/constants';
import { PaymentModal } from '@/components/treasury';
import { Briefcase, ChevronDown, ChevronRight } from 'lucide-react';

const ROLE_LABEL = { CAPTADOR: 'Captador', CERRADOR: 'Cerrador', OTHER: 'Otro' };
const STATUS_BADGE = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  PARTIAL: 'bg-sky-500/20 text-sky-400',
  PAID: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-[#6E7681]/20 text-[#6E7681] line-through',
};
const STATUS_LABEL = { PENDING: 'Pendiente', PARTIAL: 'Parcial', PAID: 'Pagado', CANCELLED: 'Cancelada' };

function CascadeRow({ label, value, negative, bold }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-semibold text-[#E6EDF3] border-t border-border pt-1 mt-1' : 'text-[#8B949E]'}`}>
      <span>{label}</span>
      <span className="font-mono">{negative ? '− ' : ''}{formatCurrency(value)}</span>
    </div>
  );
}

function CommissionCard({ item, onPay }) {
  const { vehicle, cascade, roles, buckets } = item;
  const pct = cascade.commissionBase > 0 ? Math.round((cascade.commissionPool / cascade.commissionBase) * 100) : 0;
  return (
    <div className="card p-4 space-y-3" data-testid={`commission-card-${vehicle.plate}`}>
      <div className="flex justify-between items-start">
        <div>
          <span className="plate-text">{vehicle.plate}</span>
          <span className="text-sm text-[#8B949E] ml-2">{vehicle.brand} {vehicle.model}</span>
        </div>
        <span className="text-xs text-[#6E7681]">vendida {formatDate(vehicle.saleDate)}</span>
      </div>

      {/* Cascada contable */}
      <div className="bg-[#161B22] rounded-lg p-3">
        <CascadeRow label="Venta" value={cascade.salePrice} />
        <CascadeRow label="Costo" value={cascade.purchaseCost} negative />
        <CascadeRow label="Gastos" value={cascade.directExpenses} negative />
        <CascadeRow label="Ganancia" value={cascade.grossProfit} bold />
        <CascadeRow label={`Base comisión (×${Math.round(cascade.participation * 100)}% part.)`} value={cascade.commissionBase} />
        <CascadeRow label={`Bolsillo comisión (${pct}%)`} value={cascade.commissionPool} bold />
        {buckets && (
          <div className="text-[11px] text-[#6E7681] mt-1.5">
            · Reinversión {formatCurrency(buckets.reinvest)} · Impuestos {formatCurrency(buckets.tax)} <span className="text-green-500">✓ auto</span>
          </div>
        )}
      </div>

      {/* Roles */}
      <div className="space-y-2">
        {roles.map((r) => (
          <div
            key={r.payableId}
            className="flex items-center justify-between gap-2 text-sm border-t border-border/50 pt-2"
            data-testid={`commission-role-${vehicle.plate}-${r.role}`}
          >
            <div className="min-w-0">
              <span className="font-semibold text-[#E6EDF3]">{ROLE_LABEL[r.role] || r.role}</span>
              <span className="text-[#8B949E] ml-1.5">{r.thirdParty.name} ({r.sharePct}%)</span>
              {r.payments.length > 0 && (
                <div className="text-[11px] text-[#6E7681]">
                  {r.payments.map((p, i) => (
                    <span key={i}>{formatCurrency(p.amount)} · {p.accountName} · {formatDate(p.date)}{i < r.payments.length - 1 ? ' — ' : ''}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[#E6EDF3]">{formatCurrency(r.total)}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_BADGE[r.status]}`}
                data-testid={`commission-role-status-${vehicle.plate}-${r.role}`}
              >
                {STATUS_LABEL[r.status] || r.status}
              </span>
              {(r.status === 'PENDING' || r.status === 'PARTIAL') && (
                <button
                  type="button"
                  onClick={() => onPay(item, r)}
                  className="btn-primary text-xs px-2.5 py-1"
                  data-testid={`commission-pay-${vehicle.plate}-${r.role}`}
                >
                  Pagar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CommissionsPage() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPaid, setShowPaid] = useState(false);
  const [paying, setPaying] = useState(null); // { item, role }
  const [processing, setProcessing] = useState(false);

  const load = async () => {
    try {
      const [{ data }, sumRes] = await Promise.all([
        commissionsApi.getAll(),
        commissionsApi.getSummary().catch(() => null),
      ]);
      setItems(data || []);
      setSummary(sumRes?.data || null);
    } catch (err) {
      console.error('Error loading commissions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handlePaymentSubmit = async (paymentData) => {
    setProcessing(true);
    try {
      await payablesApi.addPayment(paying.role.payableId, paymentData);
      setPaying(null);
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al registrar el pago');
    } finally {
      setProcessing(false);
    }
  };

  const pending = items.filter((i) => i.hasPending);
  const paid = items.filter((i) => !i.hasPending);
  const totalPending = pending.reduce(
    (s, i) => s + i.roles.reduce((rs, r) => rs + (r.status === 'CANCELLED' ? 0 : r.pending), 0), 0,
  );
  const pendingByRole = (role) => pending.reduce(
    (s, i) => s + i.roles.filter((r) => r.role === role && r.status !== 'CANCELLED').reduce((rs, r) => rs + r.pending, 0), 0,
  );

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-[#8B949E]">Cargando...</div></div>;
  }

  return (
    <div className="space-y-6" data-testid="commissions-page">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[#E6EDF3] inline-flex items-center gap-2">
          <Briefcase className="w-5 h-5" /> Comisiones
        </h2>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-xs text-[#6E7681]">Pendiente por pagar</div>
          <div className="text-lg font-mono font-bold text-amber-400 mt-1" data-testid="commissions-kpi-pending">
            {formatCurrency(totalPending)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[#6E7681]">Captador pendiente</div>
          <div className="text-lg font-mono font-bold text-[#BC8CFF] mt-1">{formatCurrency(pendingByRole('CAPTADOR'))}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[#6E7681]">Cerrador pendiente</div>
          <div className="text-lg font-mono font-bold text-[#BC8CFF] mt-1">{formatCurrency(pendingByRole('CERRADOR'))}</div>
        </div>
      </div>

      {/* Por persona */}
      {summary?.byPerson?.length > 0 && (
        <section className="card p-4" data-testid="commissions-by-person">
          <h3 className="text-sm font-semibold text-[#E6EDF3] mb-2">Por persona</h3>
          <div className="space-y-1.5">
            {summary.byPerson.map((p) => (
              <div
                key={p.thirdParty.id}
                className="flex items-center justify-between text-sm border-t border-border/50 pt-1.5 first:border-0 first:pt-0"
                data-testid={`commissions-person-${p.thirdParty.id}`}
              >
                <span className="text-[#E6EDF3]">{p.thirdParty.name}
                  <span className="text-[#6E7681] ml-1.5 text-xs">({p.salesCount} {p.salesCount === 1 ? 'venta' : 'ventas'})</span>
                </span>
                <span className="font-mono text-xs">
                  <span className="text-green-400">{formatCurrency(p.totalPaid)} pagado</span>
                  <span className="text-[#6E7681]"> · </span>
                  <span className={p.totalPending > 0 ? 'text-amber-400' : 'text-[#6E7681]'}>{formatCurrency(p.totalPending)} pendiente</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pendientes */}
      {pending.length === 0 ? (
        <div className="card p-8 text-center text-[#8B949E]">No hay comisiones pendientes</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {pending.map((item) => (
            <CommissionCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
          ))}
        </div>
      )}

      {/* Historial pagadas (colapsado) */}
      {paid.length > 0 && (
        <section data-testid="commissions-paid-section">
          <button
            type="button"
            onClick={() => setShowPaid((s) => !s)}
            className="w-full flex items-center gap-2 text-sm font-semibold text-[#8B949E] hover:text-[#E6EDF3]"
          >
            {showPaid ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Pagadas ({paid.length})
          </button>
          {showPaid && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
              {paid.map((item) => (
                <CommissionCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Pago por rol → flujo existente de CxP */}
      {paying && (
        <PaymentModal
          isOpen={!!paying}
          onClose={() => setPaying(null)}
          onSubmit={handlePaymentSubmit}
          title={`Pagar comisión ${ROLE_LABEL[paying.role.role] || paying.role.role} — ${paying.item.vehicle.plate}`}
          type="expense"
          totalAmount={paying.role.total}
          paidAmount={paying.role.paid}
          defaultDescription={`Comisión venta ${paying.item.vehicle.plate} — ${paying.role.role}`}
          loading={processing}
        />
      )}
    </div>
  );
}
