// ═══════════════════════════════════════════════════════════════
// SocioPendingWidget — Pendientes de socio (notificación)
// Ganancia por pagar (PARTNER_SHARE) y comisión por cobrar (RECEIVABLE socio).
// Autocontenido: hace su propio fetch; se auto-oculta si no hay pendientes.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowDownLeft, Car, Users } from 'lucide-react';
import { formatCurrency } from '@/lib/constants';
import { payablesApi } from '@/lib/payablesApi';
import PaymentModal from './PaymentModal';

const MAX_ROWS = 5;

export default function SocioPendingWidget() {
  const [data, setData] = useState(null); // { profit, commission } | null
  const [selected, setSelected] = useState(null); // { item, kind } | null
  const [processing, setProcessing] = useState(false);

  const reload = async () => {
    try {
      const res = await payablesApi.getSocioPending();
      setData(res.data);
    } catch (err) {
      console.error('Error loading socio pending:', err);
      // No romper la vista: se mantiene el último dato (o null → no se muestra).
    }
  };

  useEffect(() => {
    reload();
  }, []);

  if (!data) return null;
  const { profit, commission } = data;
  if (profit.count === 0 && commission.count === 0) return null;

  const isExpense = selected?.kind === 'profit';

  const handleSubmit = async (paymentData) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await payablesApi.addPayment(selected.item.id, paymentData);
      setSelected(null);
      await reload();
    } catch (err) {
      console.error('Error processing socio payment:', err);
      alert(err.response?.data?.error || 'Error al procesar el pago');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="card p-5" data-testid="socio-pending-widget">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-5 h-5" />
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Socios: pendientes</h3>
      </div>

      {profit.count > 0 && (
        <Section
          title="Ganancia por pagar"
          icon={<ArrowUpRight className="w-4 h-4 text-red-400" />}
          bucket={profit}
          accent="red"
          onRow={(item) => setSelected({ item, kind: 'profit' })}
        />
      )}

      {commission.count > 0 && (
        <div className={profit.count > 0 ? 'mt-5' : ''}>
          <Section
            title="Comisión por cobrar"
            icon={<ArrowDownLeft className="w-4 h-4 text-green-400" />}
            bucket={commission}
            accent="green"
            onRow={(item) => setSelected({ item, kind: 'commission' })}
          />
        </div>
      )}

      {selected && (
        <PaymentModal
          isOpen={!!selected}
          onClose={() => setSelected(null)}
          onSubmit={handleSubmit}
          title={isExpense ? 'Pagar ganancia socio' : 'Cobrar comisión socio'}
          type={isExpense ? 'expense' : 'income'}
          totalAmount={selected.item.totalAmount}
          paidAmount={selected.item.paidAmount}
          defaultDescription={
            isExpense
              ? `Ganancia socio ${selected.item.vehicle?.plate || ''}`.trim()
              : `Comisión socio ${selected.item.vehicle?.plate || ''}`.trim()
          }
          thirdPartyId={isExpense ? selected.item.thirdParty?.id : null}
          loading={processing}
        />
      )}
    </div>
  );
}

function Section({ title, icon, bucket, accent, onRow }) {
  const totalColor = accent === 'red' ? 'text-red-400' : 'text-green-400';
  const rows = bucket.items.slice(0, MAX_ROWS);
  const extra = bucket.items.length - rows.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#8B949E]">
          {icon}
          <span>{title}</span>
        </div>
        <span className={`text-sm font-mono font-semibold ${totalColor}`}>
          {formatCurrency(bucket.total)}
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((item) => (
          <div
            key={item.id}
            onClick={() => onRow(item)}
            className="flex items-center justify-between text-xs p-2 bg-surface-hover rounded-lg cursor-pointer border border-transparent hover:border-border transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[#E6EDF3] truncate flex items-center gap-1">
                <Car className="w-3.5 h-3.5 text-[#8B949E]" />
                <span className="font-mono">{item.vehicle?.plate || 'Sin placa'}</span>
              </div>
              <div className="text-[#6E7681] truncate">
                {item.vehicle && <span>{item.vehicle.brand} {item.vehicle.model} · </span>}
                {item.thirdParty?.name || 'Socio'}
              </div>
            </div>
            <div className={`font-mono font-semibold ml-2 ${totalColor}`}>
              {formatCurrency(item.pending)}
            </div>
          </div>
        ))}
        {extra > 0 && (
          <div className="text-xs text-[#6E7681] text-center pt-1">+{extra} más…</div>
        )}
      </div>
    </div>
  );
}
