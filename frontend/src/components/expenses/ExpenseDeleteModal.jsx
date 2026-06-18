import { useState } from 'react';
import Modal from '@/components/shared/Modal';
import { Textarea } from '@/components/shared/FormFields';
import { formatCurrency, formatDate, getCategory } from '@/lib/constants';

const MIN_REASON = 10;

export default function ExpenseDeleteModal({ expense, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cat = getCategory(expense?.category);

  const trimmed = reason.trim();
  const canDelete = trimmed.length >= MIN_REASON && !loading;

  const handleConfirm = async () => {
    if (!canDelete) return;
    setLoading(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error al eliminar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Eliminar gasto" width="max-w-md">
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-[#161B22] p-3 space-y-1.5">
          <div className="flex justify-between items-baseline">
            <span className="text-[11px] text-[#6E7681]">Concepto</span>
            <span className="text-sm font-semibold text-[#E6EDF3]">
              {expense?.description || cat?.label || '—'}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[11px] text-[#6E7681]">Categoría</span>
            <span className="text-xs inline-flex items-center gap-1" style={{ color: cat?.color }}>{cat?.icon && <cat.icon className="w-3.5 h-3.5" />} {cat?.label}</span>
          </div>
          {expense?.vehicle && (
            <div className="flex justify-between items-baseline">
              <span className="text-[11px] text-[#6E7681]">Vehículo</span>
              <span className="text-xs font-mono">{expense.vehicle.plate}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline">
            <span className="text-[11px] text-[#6E7681]">Monto</span>
            <span className="font-mono font-bold text-[#E6EDF3]">{formatCurrency(expense?.amount)}</span>
          </div>
          {expense?.date && (
            <div className="flex justify-between items-baseline">
              <span className="text-[11px] text-[#6E7681]">Fecha</span>
              <span className="text-xs">{formatDate(expense.date)}</span>
            </div>
          )}
        </div>

        <div className="text-[12px] text-[#D29922] bg-[#D29922]/10 border border-[#D29922]/30 rounded-lg p-3">
          Al eliminar este gasto se generará un reverso en tesorería. Tendrás 5 minutos para deshacer.
        </div>

        <Textarea
          label={`Motivo del borrado * (mín ${MIN_REASON} caracteres)`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Por qué se elimina este gasto..."
          data-testid="expense-delete-reason"
        />
        <div className="text-[11px] text-[#6E7681] -mt-2">
          {trimmed.length} / {MIN_REASON}
        </div>

        {error && (
          <div className="text-[12px] text-[#F85149] bg-[#F85149]/10 border border-[#F85149]/30 rounded-lg p-2.5">
            {error}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="btn-ghost" disabled={loading}>Cancelar</button>
        <button
          onClick={handleConfirm}
          disabled={!canDelete}
          className="btn-danger"
          data-testid="expense-delete-confirm"
        >
          {loading ? 'Eliminando...' : 'Eliminar'}
        </button>
      </div>
    </Modal>
  );
}
