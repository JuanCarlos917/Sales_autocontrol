import { useState } from 'react';
import Modal from '@/components/shared/Modal';

const MIN_REASON = 10;

const BTN_VARIANT = {
  amber: 'text-amber-400 hover:text-amber-300',
  red: 'text-red-400 hover:text-red-300',
};

const CONFIRM_VARIANT = {
  amber: 'bg-amber-600 hover:bg-amber-700',
  red: 'bg-red-600 hover:bg-red-700',
};

// Botón + modal de reverso reutilizable. `onConfirm(reason)` debe lanzar en error.
export default function ReverseAction({
  label = 'Reversar',
  title = 'Reversar',
  description = null,
  confirmLabel = 'Reversar',
  variant = 'amber',
  testid,
  onConfirm,
  onDone,
  buttonClassName = '',
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const close = () => {
    setOpen(false);
    setReason('');
    setError(null);
  };

  const handleConfirm = async () => {
    if (reason.trim().length < MIN_REASON || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      close();
      if (onDone) onDone();
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo completar el reverso');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`btn-ghost text-xs ${BTN_VARIANT[variant] || BTN_VARIANT.amber} ${buttonClassName}`}
        data-testid={`${testid}-reverse-btn`}
      >
        {label}
      </button>

      <Modal isOpen={open} onClose={close} title={title}>
        <div className="space-y-4" data-testid={`${testid}-reverse-modal`}>
          {description && <div className="text-sm text-[#8B949E]">{description}</div>}
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Motivo * (mín 10 caracteres)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input w-full"
              rows={3}
              data-testid={`${testid}-reverse-reason`}
            />
          </div>
          {error && <p className="text-sm text-red-400" data-testid={`${testid}-reverse-error`}>{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={close} className="btn-ghost flex-1">Cancelar</button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={reason.trim().length < MIN_REASON || submitting}
              className={`btn-primary flex-1 ${CONFIRM_VARIANT[variant] || CONFIRM_VARIANT.amber} disabled:opacity-50`}
              data-testid={`${testid}-reverse-confirm`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
