import { formatCurrency, formatDate } from '@/lib/constants';

// Cronograma de cuotas (solo lectura). `installments`: array crudo de la entidad
// [{ id, sequence, dueDate, plannedAmount, paidAmount, status }].
// `testidPrefix`: prefijo para los data-testid (ej. `loan-detail` / `debt-detail`).
const STATUS_LABEL = { PAID: 'Pagada', PARTIAL: 'Parcial', PENDING: 'Pendiente' };
const STATUS_COLOR = {
  PAID: 'text-green-400',
  PARTIAL: 'text-sky-400',
  PENDING: 'text-amber-400',
};

const isOverdue = (inst) =>
  inst.status !== 'PAID' && new Date(inst.dueDate) < new Date();

export default function InstallmentSchedule({ installments = [], testidPrefix }) {
  if (installments.length === 0) {
    return (
      <div className="text-sm text-[#6E7681]" data-testid={`${testidPrefix}-schedule-empty`}>
        Sin cuotas registradas
      </div>
    );
  }

  return (
    <div
      className="max-h-80 overflow-y-auto rounded-lg border border-border"
      data-testid={`${testidPrefix}-schedule`}
    >
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface text-[#6E7681]">
          <tr className="text-left">
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Vence</th>
            <th className="px-3 py-2 font-semibold text-right">Monto</th>
            <th className="px-3 py-2 font-semibold text-right">Pagado</th>
            <th className="px-3 py-2 font-semibold text-right">Estado</th>
          </tr>
        </thead>
        <tbody>
          {installments.map((inst) => {
            const overdue = isOverdue(inst);
            return (
              <tr
                key={inst.id ?? inst.sequence}
                className="border-t border-border/50"
                data-testid={`${testidPrefix}-schedule-row-${inst.sequence}`}
              >
                <td className="px-3 py-2 text-[#8B949E]">{inst.sequence}</td>
                <td className={`px-3 py-2 ${overdue ? 'text-red-400' : 'text-[#6E7681]'}`}>
                  {formatDate(inst.dueDate)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[#E6EDF3]">
                  {formatCurrency(inst.plannedAmount)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[#8B949E]">
                  {formatCurrency(inst.paidAmount)}
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  {overdue ? (
                    <span className="text-red-400">Vencida</span>
                  ) : (
                    <span className={STATUS_COLOR[inst.status] || 'text-[#6E7681]'}>
                      {STATUS_LABEL[inst.status] || inst.status}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
