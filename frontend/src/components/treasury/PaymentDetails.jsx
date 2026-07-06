import { useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/constants';
import ReverseAction from '@/components/shared/ReverseAction';
import ReversedBadge from '@/components/shared/ReversedBadge';

// Lista colapsable de pagos. `payments`: [{ id, date, amount, accountName, notes, reversedAt?, reconciled? }] (ordenada desc).
// `testidPrefix`: prefijo para los data-testid (ej. `loan-card-<id>` / `debt-card-<id>`).
// `alwaysOpen`: cuando es true, renderiza la lista expandida sin el toggle (vista de detalle).
export default function PaymentDetails({ payments = [], testidPrefix, alwaysOpen = false, onReversePayment }) {
  const [open, setOpen] = useState(false);
  const count = payments.length;
  const expanded = alwaysOpen || open;

  return (
    <div className={alwaysOpen ? '' : 'pt-3 mt-3 border-t border-border'}>
      {!alwaysOpen && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between text-xs font-semibold text-[#8B949E] hover:text-[#E6EDF3]"
          data-testid={`${testidPrefix}-details-toggle`}
        >
          <span>Detalles ({count})</span>
          <span>{open ? '▾' : '▸'}</span>
        </button>
      )}

      {expanded && (
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
                <div className="flex justify-between items-center gap-2">
                  <span className="text-[#6E7681]">{formatDate(p.date)}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[#E6EDF3]">{formatCurrency(p.amount)}</span>
                    {p.reversedAt ? (
                      <ReversedBadge label="Reversado" testid={`${testidPrefix}-row-${p.id}-reversed`} />
                    ) : p.reconciled ? (
                      <span
                        className="text-[10px] text-[#6E7681]"
                        title="Pago conciliado con un egreso real; no reversable desde aquí"
                        data-testid={`${testidPrefix}-row-${p.id}-reconciled`}
                      >
                        Conciliado
                      </span>
                    ) : onReversePayment ? (
                      <ReverseAction
                        label="Reversar"
                        title="Reversar pago"
                        description={<>Se creará un movimiento compensatorio que devuelve {formatCurrency(p.amount)} a la cuenta. El pago original no se borra.</>}
                        variant="amber"
                        testid={`${testidPrefix}-pay-${p.id}`}
                        onConfirm={(reason) => onReversePayment(p, reason)}
                      />
                    ) : null}
                  </div>
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
