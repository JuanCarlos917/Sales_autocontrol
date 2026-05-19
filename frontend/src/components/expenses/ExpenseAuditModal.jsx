import { useEffect, useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import Modal from '@/components/shared/Modal';
import { formatCurrency } from '@/lib/constants';

const ACTION_META = {
  CREATE: { icon: '➕', label: 'Creado', color: 'text-green-400' },
  UPDATE: { icon: '✏️', label: 'Editado', color: 'text-sky-400' },
  DELETE: { icon: '🗑', label: 'Eliminado', color: 'text-[#F85149]' },
  RESTORE: { icon: '↩️', label: 'Restaurado', color: 'text-amber-400' },
};

const FIELD_LABELS = {
  amount: 'Monto',
  accountId: 'Cuenta',
  category: 'Categoría',
  description: 'Descripción',
  notes: 'Notas',
  date: 'Fecha',
  paid: 'Pagado',
};

function diffFields(before, after) {
  if (!before || !after) return [];
  return Object.keys(FIELD_LABELS)
    .filter((f) => before[f] !== after[f])
    .map((f) => ({ field: f, before: before[f], after: after[f] }));
}

function formatValue(field, value) {
  if (value == null || value === '') return '—';
  if (field === 'amount') return formatCurrency(value);
  if (field === 'paid') return value === true || value === 'true' ? 'Sí' : 'No';
  if (field === 'date') return String(value).slice(0, 10);
  return String(value);
}

function timeAgo(iso) {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `hace ${diff}s`;
  if (diff < 3600) return `hace ${Math.round(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.round(diff / 3600)}h`;
  return new Date(iso).toLocaleString('es-CO');
}

export default function ExpenseAuditModal({ expenseId, onClose }) {
  const { fetchExpenseAudit } = useApp();
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchExpenseAudit(expenseId);
        setLogs(data);
      } catch (err) {
        setError(err.response?.data?.error || 'No se pudo cargar el historial');
      }
    })();
  }, [expenseId, fetchExpenseAudit]);

  return (
    <Modal onClose={onClose} title="Historial del gasto" width="max-w-lg">
      {error && (
        <div className="text-[12px] text-[#F85149] bg-[#F85149]/10 border border-[#F85149]/30 rounded-lg p-2.5">
          {error}
        </div>
      )}
      {!logs && !error && <div className="text-sm text-[#6E7681] py-8 text-center">Cargando...</div>}
      {logs && logs.length === 0 && (
        <div className="text-sm text-[#6E7681] py-8 text-center">Sin historial registrado</div>
      )}
      {logs && logs.length > 0 && (
        <ol className="space-y-3" data-testid="expense-audit-list">
          {logs.map((log) => {
            const meta = ACTION_META[log.action] || ACTION_META.UPDATE;
            const changes = log.action === 'UPDATE' ? diffFields(log.before, log.after) : [];
            return (
              <li
                key={log.id}
                className="border border-border rounded-lg p-3 bg-[#161B22] space-y-2"
                data-testid={`expense-audit-entry-${log.action.toLowerCase()}`}
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{meta.icon}</span>
                    <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
                    <span className="text-[11px] text-[#6E7681]">
                      por {log.user?.name || log.user?.email || 'usuario'}
                    </span>
                  </div>
                  <span className="text-[11px] text-[#6E7681] shrink-0">{timeAgo(log.createdAt)}</span>
                </div>
                {log.reason && (
                  <div className="text-[12px] text-[#E6EDF3]/80 italic">"{log.reason}"</div>
                )}
                {changes.length > 0 && (
                  <ul className="space-y-1">
                    {changes.map((c) => (
                      <li key={c.field} className="text-[11px] flex gap-2 items-center">
                        <span className="text-[#6E7681] font-medium min-w-[72px]">{FIELD_LABELS[c.field]}:</span>
                        <span className="text-[#8B949E] line-through">{formatValue(c.field, c.before)}</span>
                        <span className="text-[#6E7681]">→</span>
                        <span className="text-[#E6EDF3] font-mono">{formatValue(c.field, c.after)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex justify-end mt-5">
        <button onClick={onClose} className="btn-ghost">Cerrar</button>
      </div>
    </Modal>
  );
}
