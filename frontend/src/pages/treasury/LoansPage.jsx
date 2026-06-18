import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { loansApi } from '@/lib/treasuryApi';
import { formatCurrency, formatDate } from '@/lib/constants';
import { NewLoanModal, LoanPaymentModal } from '@/components/treasury';
import { useAuth } from '@/contexts/AuthContext';
import { X, HandCoins, Calendar } from 'lucide-react';

const STATUS_LABEL = {
  PENDING: 'Pendiente',
  PARTIAL: 'Parcial',
  PAID: 'Pagado',
  CANCELLED: 'Cancelado',
};

const STATUS_COLOR = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  PARTIAL: 'bg-sky-500/20 text-sky-400',
  PAID: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-[#6E7681]/20 text-[#6E7681]',
};

const TABS = [
  { id: 'all', label: 'Todos' },
  { id: 'active', label: 'Activos' },
  { id: 'overdue', label: 'Vencidos' },
  { id: 'paid', label: 'Pagados' },
];

export default function LoansPage() {
  const { isViewer } = useAuth();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [paying, setPaying] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const borrowerFilter = searchParams.get('borrower');

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await loansApi.getAll();
      setLoans(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const borrowerName = useMemo(() => {
    if (!borrowerFilter) return null;
    const match = loans.find((l) => l.borrowerId === borrowerFilter);
    return match?.borrower?.name || null;
  }, [borrowerFilter, loans]);

  const clearBorrowerFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('borrower');
    setSearchParams(next);
  };

  const filtered = loans
    .filter((l) => (borrowerFilter ? l.borrowerId === borrowerFilter : true))
    .filter((l) => {
      if (tab === 'all') return true;
      if (tab === 'active') return l.status === 'PENDING' || l.status === 'PARTIAL';
      if (tab === 'overdue') return l.isOverdue;
      if (tab === 'paid') return l.status === 'PAID';
      return true;
    });

  const totals = {
    lent: loans.reduce((s, l) => s + parseFloat(l.principalAmount), 0),
    toRepay: loans.reduce((s, l) => s + parseFloat(l.principalAmount) + parseFloat(l.interestAmount || 0), 0),
    paid: loans.reduce((s, l) => s + parseFloat(l.paidAmount), 0),
  };
  totals.pending = totals.toRepay - totals.paid;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/treasury" className="text-[#6E7681] hover:text-accent transition-colors">← Tesorería</Link>
          <h2 className="text-xl font-bold text-[#E6EDF3] mt-2">Préstamos internos</h2>
          <p className="text-sm text-[#6E7681] mt-1">Dinero prestado a terceros con cronograma de devolución</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <div className="text-[#6E7681]">Prestado</div>
            <div className="font-mono font-bold text-[#E6EDF3]">{formatCurrency(totals.lent)}</div>
          </div>
          <div className="text-right">
            <div className="text-[#6E7681]">Devuelto</div>
            <div className="font-mono font-bold text-green-400">{formatCurrency(totals.paid)}</div>
          </div>
          <div className="text-right">
            <div className="text-[#6E7681]">Pendiente</div>
            <div className="font-mono font-bold text-amber-400">{formatCurrency(totals.pending)}</div>
          </div>
          {!isViewer && (
            <button
              onClick={() => setShowNew(true)}
              className="btn-primary"
              data-testid="loans-create-button"
            >
              + Nuevo préstamo
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === t.id ? 'bg-accent/20 text-accent' : 'text-[#6E7681] hover:bg-surface-hover'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {borrowerFilter && (
        <div
          className="flex items-center gap-2 text-xs"
          data-testid="loans-borrower-filter-badge"
        >
          <span className="text-[#6E7681]">Filtrando por:</span>
          <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-accent/15 text-accent">
            <span className="font-medium">{borrowerName || 'Deudor'}</span>
            <button
              type="button"
              onClick={clearBorrowerFilter}
              className="text-accent/70 hover:text-accent transition-colors"
              aria-label="Limpiar filtro"
              data-testid="loans-borrower-filter-clear"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-[#6E7681]">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <HandCoins className="w-11 h-11 mx-auto mb-4 text-[#6E7681]" />
          <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">Sin préstamos</h3>
          <p className="text-sm text-[#6E7681]">Creá uno con el botón de arriba.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((loan) => {
            const totalToRepay = parseFloat(loan.principalAmount) + parseFloat(loan.interestAmount || 0);
            const pending = totalToRepay - parseFloat(loan.paidAmount);
            const next = loan.installments?.find((i) => i.status !== 'PAID');
            return (
              <div
                key={loan.id}
                className={`card p-4 ${loan.isOverdue ? 'border-red-500/40' : ''}`}
                data-testid={`loan-card-${loan.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-base font-semibold text-[#E6EDF3]">{loan.borrower?.name}</div>
                    <div className="text-xs text-[#6E7681]">{loan.description || 'Préstamo interno'}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLOR[loan.status]}`}>
                    {STATUS_LABEL[loan.status]}
                  </span>
                </div>
                <div className="flex justify-between items-end mb-3">
                  <div>
                    <div className="text-xs text-[#6E7681]">Pendiente</div>
                    <div className="text-xl font-mono font-bold text-amber-400">{formatCurrency(pending)}</div>
                  </div>
                  <div className="text-right text-xs text-[#6E7681]">
                    de {formatCurrency(totalToRepay)}
                    {parseFloat(loan.interestAmount || 0) > 0 && (
                      <div className="text-[#8B949E]">incl. interés {formatCurrency(loan.interestAmount)}</div>
                    )}
                  </div>
                </div>
                {next && (
                  <div className={`text-xs mb-3 inline-flex items-center gap-1.5 ${loan.isOverdue ? 'text-red-400' : 'text-[#6E7681]'}`}>
                    <Calendar className="w-3.5 h-3.5 shrink-0" /> Próxima cuota #{next.sequence}: {formatDate(next.dueDate)} ({formatCurrency(next.plannedAmount)})
                  </div>
                )}
                {parseFloat(loan.extraReceived) > 0 && (
                  <div className="text-xs text-green-400 mb-3">
                    + {formatCurrency(loan.extraReceived)} en ingresos extra
                  </div>
                )}
                <div className="flex items-center gap-2 pt-3 border-t border-border">
                  {loan.status !== 'PAID' && loan.status !== 'CANCELLED' && !isViewer && (
                    <button
                      onClick={() => setPaying(loan)}
                      className="flex-1 py-2 rounded-lg text-xs font-semibold bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      data-testid={`loan-card-${loan.id}-pay-button`}
                    >
                      <span className="inline-flex items-center justify-center gap-1.5"><HandCoins className="w-3.5 h-3.5" /> Registrar pago</span>
                    </button>
                  )}
                  <Link
                    to={`/treasury/loans/${loan.id}`}
                    className="flex-1 text-center py-2 rounded-lg text-xs font-semibold bg-surface-hover text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
                    data-testid={`loan-card-${loan.id}-detail-link`}
                  >
                    Ver detalle →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewLoanModal isOpen={showNew} onClose={() => setShowNew(false)} onCreated={reload} />
      <LoanPaymentModal isOpen={!!paying} loan={paying} onClose={() => setPaying(null)} onPaid={reload} />
    </div>
  );
}
