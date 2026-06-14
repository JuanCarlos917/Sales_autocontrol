import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { debtsApi } from '@/lib/treasuryApi';
import { formatCurrency, formatDate } from '@/lib/constants';
import { NewDebtModal, DebtPaymentModal, DebtReconcileModal } from '@/components/treasury';

const STATUS_LABEL = { PENDING: 'Pendiente', PARTIAL: 'Parcial', PAID: 'Pagado', CANCELLED: 'Cancelado' };
const STATUS_COLOR = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  PARTIAL: 'bg-sky-500/20 text-sky-400',
  PAID: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-[#6E7681]/20 text-[#6E7681]',
};

export default function DebtsPage() {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [paying, setPaying] = useState(null);
  const [reconciling, setReconciling] = useState(null);

  const reload = async () => {
    setLoading(true);
    try { const { data } = await debtsApi.getAll(); setDebts(data); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const totals = {
    owed: debts.reduce((s, d) => s + parseFloat(d.totalAmount), 0),
    paid: debts.reduce((s, d) => s + parseFloat(d.paidAmount), 0),
  };
  totals.pending = totals.owed - totals.paid;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/treasury" className="text-[#6E7681] hover:text-accent transition-colors">← Tesorería</Link>
          <h2 className="text-xl font-bold text-[#E6EDF3] mt-2">Créditos / financiaciones</h2>
          <p className="text-sm text-[#6E7681] mt-1">Deudas del negocio con cronograma de cuotas</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right"><div className="text-[#6E7681]">Debido</div><div className="font-mono font-bold text-[#E6EDF3]">{formatCurrency(totals.owed)}</div></div>
          <div className="text-right"><div className="text-[#6E7681]">Pagado</div><div className="font-mono font-bold text-green-400">{formatCurrency(totals.paid)}</div></div>
          <div className="text-right"><div className="text-[#6E7681]">Pendiente</div><div className="font-mono font-bold text-amber-400">{formatCurrency(totals.pending)}</div></div>
          <button onClick={() => setShowNew(true)} className="btn-primary" data-testid="debts-create-button">+ Nuevo crédito</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-[#6E7681]">Cargando...</div>
      ) : debts.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-4">🏦</div>
          <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">Sin créditos</h3>
          <p className="text-sm text-[#6E7681]">Creá uno con el botón de arriba.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {debts.map((debt) => {
            const pending = parseFloat(debt.totalAmount) - parseFloat(debt.paidAmount);
            const next = debt.installments?.find((i) => i.status !== 'PAID');
            return (
              <div key={debt.id} className={`card p-4 ${debt.isOverdue ? 'border-red-500/40' : ''}`} data-testid={`debt-card-${debt.id}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-base font-semibold text-[#E6EDF3]">{debt.name}</div>
                    <div className="text-xs text-[#6E7681]">{debt.lender || debt.assetDescription || 'Crédito'}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLOR[debt.status]}`}>{STATUS_LABEL[debt.status]}</span>
                </div>
                <div className="flex justify-between items-end mb-3">
                  <div><div className="text-xs text-[#6E7681]">Pendiente</div><div className="text-xl font-mono font-bold text-amber-400">{formatCurrency(pending)}</div></div>
                  <div className="text-right text-xs text-[#6E7681]">de {formatCurrency(debt.totalAmount)}</div>
                </div>
                {next && (
                  <div className={`text-xs mb-3 ${debt.isOverdue ? 'text-red-400' : 'text-[#6E7681]'}`}>
                    📅 Próxima cuota #{next.sequence}: {formatDate(next.dueDate)} ({formatCurrency(next.plannedAmount)})
                  </div>
                )}
                <div className="flex gap-2 pt-3 border-t border-border">
                  {debt.status !== 'PAID' && debt.status !== 'CANCELLED' && (
                    <button onClick={() => setPaying(debt)} className="flex-1 py-2 rounded-lg text-xs font-semibold bg-green-500/20 text-green-400 hover:bg-green-500/30" data-testid={`debt-card-${debt.id}-pay-button`}>💸 Pagar cuota</button>
                  )}
                  <button onClick={() => setReconciling(debt)} className="flex-1 py-2 rounded-lg text-xs font-semibold bg-sky-500/20 text-sky-400 hover:bg-sky-500/30" data-testid={`debt-card-${debt.id}-reconcile-button`}>🔗 Reconciliar</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewDebtModal isOpen={showNew} onClose={() => setShowNew(false)} onCreated={reload} />
      <DebtPaymentModal isOpen={!!paying} debt={paying} onClose={() => setPaying(null)} onPaid={reload} />
      <DebtReconcileModal isOpen={!!reconciling} debt={reconciling} onClose={() => setReconciling(null)} onDone={reload} />
    </div>
  );
}
