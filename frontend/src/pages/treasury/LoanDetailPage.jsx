import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { loansApi } from '@/lib/treasuryApi';
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

export default function LoanDetailPage() {
  const { id } = useParams();
  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = async () => {
    try {
      const { data } = await loansApi.getById(id);
      setLoan(data);
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
    return <div className="text-center py-12 text-[#6E7681]" data-testid="loan-detail-loading">Cargando...</div>;
  }

  if (notFound || !loan) {
    return (
      <div className="card p-12 text-center" data-testid="loan-detail-not-found">
        <SearchX className="w-11 h-11 mx-auto mb-4 text-[#6E7681]" />
        <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">Préstamo no encontrado</h3>
        <Link to="/treasury/loans" className="text-accent hover:underline">← Volver a préstamos</Link>
      </div>
    );
  }

  const installments = loan.installments || [];
  const paidCount = installments.filter((i) => i.status === 'PAID').length;
  const totalCount = installments.length;
  const principal = parseFloat(loan.principalAmount);
  const interest = parseFloat(loan.interestAmount || 0);
  const totalToRepay = principal + interest;
  const paid = parseFloat(loan.paidAmount);
  const pending = totalToRepay - paid;
  // Tasa pactada: el valor se guarda como porcentaje entero (ej. 10 = 10%, 100 = 100%).
  // Se muestra sin decimales forzados, agregando los que tenga (ej. 12.5%).
  const rate = parseFloat(loan.interestRate);
  const rateLabel = isNaN(rate) ? '—' : `${rate}%`;

  const payments = (loan.payments || []).map((p) => ({
    id: p.id,
    date: p.date,
    amount: parseFloat(p.principalAmount) + parseFloat(p.extraAmount || 0),
    accountName: p.account?.name,
    notes: p.notes,
    reversedAt: p.reversedAt,
  }));

  return (
    <div className="space-y-6" data-testid="loan-detail-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/treasury/loans" className="text-[#6E7681] hover:text-accent transition-colors" data-testid="loan-detail-back">
            ← Préstamos
          </Link>
          <h2 className="text-xl font-bold text-[#E6EDF3] mt-2">{loan.borrower?.name || 'Préstamo'}</h2>
          <p className="text-sm text-[#6E7681] mt-1">{loan.description || 'Préstamo interno'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-1 rounded font-medium ${STATUS_COLOR[loan.status]}`}>
            {STATUS_LABEL[loan.status]}
          </span>
          {loan.status !== 'CANCELLED' && (
            <ReverseAction
              label="Anular préstamo"
              title="Anular préstamo"
              description={<>Se reversarán el desembolso y todos los pagos vivos (asientos compensatorios). El préstamo quedará CANCELADO. Esta acción no se puede deshacer.</>}
              confirmLabel="Anular préstamo"
              variant="red"
              testid="loan-detail"
              onConfirm={(reason) => loansApi.reverseLoan(id, reason)}
              onDone={load}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4" data-testid="loan-detail-summary">
        <Kpi label="Valor prestado (capital)" value={formatCurrency(principal)} testid="loan-detail-kpi-principal" />
        <Kpi label="Tasa pactada" value={rateLabel} testid="loan-detail-kpi-rate" />
        <Kpi label="Interés pactado" value={formatCurrency(interest)} testid="loan-detail-kpi-interest-amount" />
        <Kpi label="Total a devolver" value={formatCurrency(totalToRepay)} testid="loan-detail-kpi-total" />
        <Kpi label="Cuotas pagadas" value={`${paidCount} / ${totalCount}`} testid="loan-detail-kpi-installments" />
        <Kpi label="Valor pagado" value={formatCurrency(paid)} accent="text-green-400" testid="loan-detail-kpi-paid" />
        <Kpi label="Intereses recibidos" value={formatCurrency(loan.interestReceived)} accent="text-green-400" testid="loan-detail-kpi-interest" />
        <Kpi label="Saldo pendiente" value={formatCurrency(pending)} accent="text-amber-400" testid="loan-detail-kpi-pending" />
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Pagos ({payments.length})</h3>
        <div className="card p-4">
          <PaymentDetails
            testidPrefix="loan-detail"
            payments={payments}
            alwaysOpen
            onReversePayment={async (p, reason) => {
              await loansApi.reversePayment(p.id, reason);
              await load();
            }}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Cronograma de cuotas</h3>
        <InstallmentSchedule testidPrefix="loan-detail" installments={installments} />
      </section>
    </div>
  );
}
