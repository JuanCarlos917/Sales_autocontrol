// ═══════════════════════════════════════════════════════════════
// MonthGroupedGrid — pinta una lista de cards agrupadas por mes, con
// encabezado (count de negocios) y subtotal del mes. Reutilizado por
// CommissionsPage e InvestorsPage.
// ═══════════════════════════════════════════════════════════════

import { groupByMonth } from '@/lib/monthGrouping';
import { formatCurrency } from '@/lib/constants';

export default function MonthGroupedGrid({ items, renderCard, sumOf, dateOf }) {
  const groups = groupByMonth(items, { dateOf, sumOf });

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.monthKey} data-testid={`month-group-${g.monthKey}`}>
          <div className="flex items-center justify-between mb-3 border-b border-border pb-1.5">
            <h4 className="text-sm font-semibold text-[#E6EDF3]">
              {g.monthLabel}
              <span className="text-[#6E7681] font-normal ml-2 text-xs">
                {g.count} {g.count === 1 ? 'negocio' : 'negocios'}
              </span>
            </h4>
            <span
              className="font-mono text-sm text-[#E6EDF3]"
              data-testid={`month-group-subtotal-${g.monthKey}`}
            >
              {formatCurrency(g.subtotal)} <span className="text-[#6E7681] text-xs">total</span>
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {g.items.map(renderCard)}
          </div>
        </section>
      ))}
    </div>
  );
}
