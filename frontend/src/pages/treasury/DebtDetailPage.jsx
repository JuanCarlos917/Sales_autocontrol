import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { debtsApi } from '@/lib/treasuryApi';
import { formatCurrency } from '@/lib/constants';
import PaymentDetails from '@/components/treasury/PaymentDetails';
import InstallmentSchedule from '@/components/treasury/InstallmentSchedule';
import ReverseAction from '@/components/shared/ReverseAction';
import { SearchX } from 'lucide-react';

const STATUS_LABEL = { PENDING: 'Pendiente', PARTIAL: 'Parcial', PAID: 'Pagado', CANCELLED: 'Cancelado' };
const STATUS_COLOR = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  PARTIAL: 'bg-sky-500/20 text-sky-400',
  PAID: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-[#6E7681]/20 text-[#6E7681]',
};

function Kpi({ label, value, accent, testid }) {
  return (
    <div className="card p-4" data-testid={testid}>
      <div className="text-xs text-[#6E7681]">{label}</div>
      <div className={`text-lg font-mono font-bold mt-1 ${accent || 'text-[#E6EDF3]'}`}>{value}</div>
    </div>
  );
}

export default function DebtDetailPage() {
  const { id } = useParams();
  const [debt, setDebt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = async () => {
    try {
      const { data } = await debtsApi.getById(id);
      setDebt(data);
      setNotFound(false);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return <div className="text-center py-12 text-[#6E7681]" data-testid="debt-detail-loading">Cargando...</div>;
  }

  if (notFound || !debt) {
    return (
      <div className="card p-12 text-center" data-testid="debt-detail-not-found">
        <SearchX className="w-11 h-11 mx-auto mb-4 text-[#6E7681]" />
        <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">Crédito no encontrado</h3>
        <Link to="/treasury/debts" className="text-accent hover:underline">← Volver a créditos</Link>
      </div>
    );
  }

  const installments = debt.installments || [];
  const paidCount = installments.filter((i) => i.status === 'PAID').length;
  const totalCount = installments.length;
  const total = parseFloat(debt.totalAmount);
  const paid = parseFloat(debt.paidAmount);
  const pending = total - paid;

  const payments = (debt.payments || []).map((p) => ({
    id: p.id,
    date: p.date,
    amount: parseFloat(p.amount),
    accountName: p.account?.name,
    notes: p.notes,
    reversedAt: p.reversedAt,
    reconciled: p.reconciled,
  }));

  return (
    <div className="space-y-6" data-testid="debt-detail-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/treasury/debts" className="text-[#6E7681] hover:text-accent transition-colors" data-testid="debt-detail-back">
            ← Créditos
          </Link>
          <h2 className="text-xl font-bold text-[#E6EDF3] mt-2">{debt.name}</h2>
          <p className="text-sm text-[#6E7681] mt-1">{debt.lender || debt.assetDescription || 'Crédito'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-1 rounded font-medium ${STATUS_COLOR[debt.status]}`}>
            {STATUS_LABEL[debt.status]}
          </span>
          {debt.status !== 'CANCELLED' && (
            <ReverseAction
              label="Anular crédito"
              title="Anular crédito"
              description={<>Se reversarán todos los pagos vivos (asientos compensatorios) y el crédito quedará CANCELADO. Si tiene pagos conciliados, la anulación se bloqueará. Esta acción no se puede deshacer.</>}
              confirmLabel="Anular crédito"
              variant="red"
              testid="debt-detail"
              onConfirm={(reason) => debtsApi.reverseDebt(id, reason)}
              onDone={load}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="debt-detail-summary">
        <Kpi label="Valor financiado" value={formatCurrency(total)} testid="debt-detail-kpi-total" />
        <Kpi label="Cuotas pagadas" value={`${paidCount} / ${totalCount}`} testid="debt-detail-kpi-installments" />
        <Kpi label="Valor pagado" value={formatCurrency(paid)} accent="text-green-400" testid="debt-detail-kpi-paid" />
        <Kpi label="Saldo pendiente" value={formatCurrency(pending)} accent="text-amber-400" testid="debt-detail-kpi-pending" />
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Pagos ({payments.length})</h3>
        <div className="card p-4">
          <PaymentDetails
            testidPrefix="debt-detail"
            payments={payments}
            alwaysOpen
            onReversePayment={async (p, reason) => {
              await debtsApi.reversePayment(p.id, reason);
              await load();
            }}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Cronograma de cuotas</h3>
        <InstallmentSchedule testidPrefix="debt-detail" installments={installments} />
      </section>
    </div>
  );
}
