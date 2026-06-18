// ═══════════════════════════════════════════════════════════════
// LoansSummaryCards — Resumen de préstamos en el landing de Tesorería
// Spec: docs/superpowers/specs/2026-05-06-loans-summary-cards-design.md
// ═══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loansApi } from '@/lib/treasuryApi';
import { formatCurrency } from '@/lib/constants';
import { Circle, HandCoins, Check } from 'lucide-react';

const STATUS_META = {
  OVERDUE: { icon: Circle, label: 'Vencido', color: 'text-red-400', badge: 'bg-red-500/20 text-red-400' },
  UPCOMING: { icon: Circle, label: 'Próximo', color: 'text-amber-400', badge: 'bg-amber-500/20 text-amber-400' },
  ON_TRACK: { icon: Circle, label: 'Al día', color: 'text-green-400', badge: 'bg-green-500/20 text-green-400' },
};

const STATUS_ORDER = ['OVERDUE', 'UPCOMING', 'ON_TRACK'];

function classifyLoan(loan, now, soon) {
  const installments = loan.installments || [];
  const overdue = installments.some(
    (i) => i.status !== 'PAID' && new Date(i.dueDate) < now,
  );
  if (overdue) return 'OVERDUE';
  const upcoming = installments.some(
    (i) => i.status !== 'PAID' && new Date(i.dueDate) <= soon,
  );
  if (upcoming) return 'UPCOMING';
  return 'ON_TRACK';
}

function classifyBorrower(loanClasses) {
  if (loanClasses.includes('OVERDUE')) return 'OVERDUE';
  if (loanClasses.includes('UPCOMING')) return 'UPCOMING';
  return 'ON_TRACK';
}

function aggregate(loans) {
  const now = new Date();
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);

  const active = loans.filter((l) => l.status !== 'PAID' && l.status !== 'CANCELLED');

  const byBorrower = new Map();
  for (const loan of active) {
    const cls = classifyLoan(loan, now, soon);
    const pending = parseFloat(loan.principalAmount) - parseFloat(loan.paidAmount);
    const existing = byBorrower.get(loan.borrowerId) || {
      borrowerId: loan.borrowerId,
      borrower: loan.borrower,
      totalPending: 0,
      loanCount: 0,
      classes: [],
    };
    existing.totalPending += pending;
    existing.loanCount += 1;
    existing.classes.push(cls);
    byBorrower.set(loan.borrowerId, existing);
  }

  const borrowers = Array.from(byBorrower.values()).map((b) => ({
    ...b,
    status: classifyBorrower(b.classes),
  }));

  const totalsByStatus = { OVERDUE: 0, UPCOMING: 0, ON_TRACK: 0 };
  for (const b of borrowers) {
    totalsByStatus[b.status] += b.totalPending;
  }

  const grandTotal = borrowers.reduce((s, b) => s + b.totalPending, 0);

  return {
    activeLoanCount: active.length,
    borrowerCount: borrowers.length,
    grandTotal,
    totalsByStatus,
    borrowers,
  };
}

function sortBorrowers(borrowers) {
  return [...borrowers].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status);
    const bi = STATUS_ORDER.indexOf(b.status);
    if (ai !== bi) return ai - bi;
    return b.totalPending - a.totalPending;
  });
}

export default function LoansSummaryCards() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await loansApi.getAll();
        if (!cancelled) setLoans(data || []);
      } catch (err) {
        console.error('Error loading loans summary:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => aggregate(loans), [loans]);
  const top = useMemo(() => sortBorrowers(summary.borrowers).slice(0, 5), [summary.borrowers]);

  const isEmpty = !loading && summary.activeLoanCount === 0;

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      data-testid="loans-summary-cards"
    >
      {/* Card 1 — Saldo total */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#E6EDF3] inline-flex items-center gap-1.5"><HandCoins className="w-4 h-4" /> Préstamos activos</h3>
          <Link
            to="/treasury/loans"
            className="text-xs text-[#6E7681] hover:text-accent transition-colors"
          >
            Ver todos →
          </Link>
        </div>

        {loading ? (
          <div className="text-sm text-[#6E7681]">Cargando...</div>
        ) : isEmpty ? (
          <>
            <div
              className="text-2xl font-mono font-bold text-[#E6EDF3] mb-1"
              data-testid="loans-summary-total"
            >
              {formatCurrency(0)}
            </div>
            <div className="text-xs text-[#6E7681]">Sin préstamos activos</div>
          </>
        ) : (
          <>
            <div
              className="text-2xl font-mono font-bold text-amber-400 mb-3"
              data-testid="loans-summary-total"
            >
              {formatCurrency(summary.grandTotal)}
            </div>
            <div className="space-y-1 text-xs">
              {STATUS_ORDER.map((s) => {
                const amount = summary.totalsByStatus[s];
                if (amount === 0) return null;
                const meta = STATUS_META[s];
                return (
                  <div key={s} className="flex justify-between">
                    <span className="text-[#8B949E] inline-flex items-center gap-1.5">
                      <meta.icon className={`w-2 h-2 fill-current ${meta.color}`} /> {meta.label}
                    </span>
                    <span className={`font-mono ${meta.color}`}>{formatCurrency(amount)}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-border text-xs text-[#6E7681]">
              {summary.activeLoanCount} préstamo{summary.activeLoanCount !== 1 ? 's' : ''} •{' '}
              {summary.borrowerCount} deudor{summary.borrowerCount !== 1 ? 'es' : ''}
            </div>
          </>
        )}
      </div>

      {/* Card 2 — Top 5 deudores */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Top deudores</h3>
          {!isEmpty && !loading && (
            <Link
              to="/treasury/loans"
              className="text-xs text-[#6E7681] hover:text-accent transition-colors"
            >
              Ver todos →
            </Link>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-[#6E7681]">Cargando...</div>
        ) : isEmpty ? (
          <div className="text-sm text-[#6E7681] py-4 text-center inline-flex items-center justify-center gap-1.5 w-full"><Check className="w-4 h-4 text-green-400" /> Nadie debe dinero</div>
        ) : (
          <ul className="divide-y divide-border">
            {top.map((b) => {
              const meta = STATUS_META[b.status];
              return (
                <li key={b.borrowerId}>
                  <button
                    type="button"
                    onClick={() => navigate(`/treasury/loans?borrower=${b.borrowerId}`)}
                    className="w-full flex items-center justify-between gap-3 py-2.5 px-1 hover:bg-surface-hover rounded transition-colors text-left"
                    data-testid={`loans-summary-borrower-${b.borrowerId}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium inline-flex items-center ${meta.badge}`}>
                        <meta.icon className="w-2.5 h-2.5 fill-current" />
                      </span>
                      <span className="text-sm text-[#E6EDF3] truncate">{b.borrower?.name}</span>
                    </div>
                    <span className="text-sm font-mono text-amber-400 shrink-0">
                      {formatCurrency(b.totalPending)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
