import { useEffect, useState } from 'react';
import Modal from '@/components/shared/Modal';
import { accountsApi, loansApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';

export default function LoanPaymentModal({ isOpen, onClose, onPaid, loan }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [extra, setExtra] = useState('');
  const [date, setDate] = useState(getLocalDateString());
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const remaining = loan ? parseFloat(loan.principalAmount) - parseFloat(loan.paidAmount) : 0;
  const nextInst = loan?.installments?.find((i) => i.status !== 'PAID');
  const nextOwed = nextInst ? Math.max(0, parseFloat(nextInst.plannedAmount) - parseFloat(nextInst.paidAmount)) : 0;

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setExtra('');
    setNotes('');
    setDate(getLocalDateString());
    setPrincipal(nextOwed > 0 ? String(nextOwed) : String(remaining));
    accountsApi.getAll().then((res) => {
      const active = res.data.filter((a) => a.isActive);
      setAccounts(active);
      setAccountId((curr) => (curr ? curr : active[0]?.id || ''));
    });
  }, [isOpen, loan]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await loansApi.addPayment(loan.id, {
        accountId,
        principalAmount: parseFloat(principal || 0),
        extraAmount: parseFloat(extra || 0),
        date: date || null,
        notes: notes || null,
      });
      onPaid?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar el pago');
    } finally {
      setLoading(false);
    }
  };

  if (!loan) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Pago de préstamo: ${loan.borrower?.name || ''}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-surface-hover rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-[#8B949E]">Saldo pendiente:</span>
            <span className="text-amber-400 font-semibold">{formatCurrency(remaining)}</span>
          </div>
          {nextInst && (
            <div className="flex justify-between">
              <span className="text-[#8B949E]">Próxima cuota (#{nextInst.sequence}):</span>
              <span>{formatCurrency(nextOwed)} • vence {new Date(nextInst.dueDate).toLocaleDateString('es-CO')}</span>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Cuenta destino *</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="input w-full"
            required
            data-testid="loan-payment-account"
          >
            <option value="">Seleccionar</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Monto principal</label>
          <input
            type="number"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            className="input w-full"
            min="0"
            data-testid="loan-payment-principal"
          />
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Monto extra (ingreso adicional voluntario, no descuenta saldo)</label>
          <input
            type="number"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            className="input w-full"
            min="0"
            placeholder="0"
            data-testid="loan-payment-extra"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Notas</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="input w-full" placeholder="Opcional" />
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={loading}>Cancelar</button>
          <button type="submit" className="btn-primary flex-1" disabled={loading} data-testid="loan-payment-submit">
            {loading ? 'Procesando...' : 'Registrar pago'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
