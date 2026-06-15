import { useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/constants';

// Lista colapsable de pagos. `payments`: [{ id, date, amount, accountName, notes }] (ordenada desc).
// `testidPrefix`: prefijo para los data-testid (ej. `loan-card-<id>` / `debt-card-<id>`).
export default function PaymentDetails({ payments = [], testidPrefix }) {
  const [open, setOpen] = useState(false);
  const count = payments.length;

  return (
    <div className="pt-3 mt-3 border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-xs font-semibold text-[#8B949E] hover:text-[#E6EDF3]"
        data-testid={`${testidPrefix}-details-toggle`}
      >
        <span>Detalles ({count})</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2" data-testid={`${testidPrefix}-details`}>
          {count === 0 ? (
            <div className="text-xs text-[#6E7681]">Sin pagos registrados</div>
          ) : (
            payments.map((p) => (
              <div
                key={p.id}
                className="text-xs border-t border-border/50 pt-2 first:border-0 first:pt-0"
                data-testid={`${testidPrefix}-details-row-${p.id}`}
              >
                <div className="flex justify-between">
                  <span className="text-[#6E7681]">{formatDate(p.date)}</span>
                  <span className="font-mono text-[#E6EDF3]">{formatCurrency(p.amount)}</span>
                </div>
                <div className="text-[#6E7681]">{p.accountName || '—'}</div>
                <div className="text-[#8B949E]">{p.notes || '—'}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
