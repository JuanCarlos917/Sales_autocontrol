// ═══════════════════════════════════════════════════════════════
// PaymentModal — Modal genérico para registrar pagos/cobros
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import Modal from '@/components/shared/Modal';
import { accountsApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';

export default function PaymentModal({
  isOpen,
  onClose,
  onSubmit,
  title = 'Registrar Pago',
  type = 'expense', // 'expense' | 'income'
  totalAmount = 0,
  paidAmount = 0,
  defaultDescription = '',
  loading = false,
}) {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({
    accountId: '',
    amount: '',
    date: getLocalDateString(),
    description: defaultDescription,
  });
  const [warning, setWarning] = useState(null);

  const pendingAmount = totalAmount - paidAmount;
  const isIncome = type === 'income';

  useEffect(() => {
    if (isOpen) {
      loadAccounts();
      setForm({
        accountId: '',
        amount: pendingAmount > 0 ? pendingAmount.toString() : '',
        date: getLocalDateString(),
        description: defaultDescription,
      });
      setWarning(null);
    }
  }, [isOpen, pendingAmount, defaultDescription]);

  const loadAccounts = async () => {
    try {
      const { data } = await accountsApi.getAll();
      setAccounts(data.filter(a => a.isActive));
      if (data.length > 0) {
        setForm(f => (f.accountId ? f : { ...f, accountId: data[0].id }));
      }
    } catch (err) {
      console.error('Error loading accounts:', err);
    }
  };

  const handleAmountChange = (value) => {
    const amount = parseFloat(value) || 0;
    setForm({ ...form, amount: value });

    // Verificar si excede el pendiente
    if (amount > pendingAmount && pendingAmount > 0) {
      setWarning(`El monto excede el saldo pendiente de ${formatCurrency(pendingAmount)}`);
    } else {
      // Verificar saldo de cuenta para egresos
      if (!isIncome && form.accountId) {
        const account = accounts.find(a => a.id === form.accountId);
        if (account && amount > parseFloat(account.currentBalance)) {
          setWarning(`La cuenta quedará con saldo negativo`);
        } else {
          setWarning(null);
        }
      } else {
        setWarning(null);
      }
    }
  };

  const handleAccountChange = (accountId) => {
    setForm({ ...form, accountId });
    // Re-check balance warning
    if (!isIncome) {
      const account = accounts.find(a => a.id === accountId);
      const amount = parseFloat(form.amount) || 0;
      if (account && amount > parseFloat(account.currentBalance)) {
        setWarning(`La cuenta quedará con saldo negativo`);
      } else {
        setWarning(null);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.accountId || !form.amount) return;

    const amount = parseFloat(form.amount);
    if (amount <= 0) {
      setWarning('El monto debe ser mayor a 0');
      return;
    }
    if (pendingAmount > 0 && amount > pendingAmount) {
      setWarning(`El monto no puede exceder ${formatCurrency(pendingAmount)}`);
      return;
    }

    await onSubmit({
      accountId: form.accountId,
      amount,
      date: form.date || null,
      description: form.description || null,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Resumen */}
        {totalAmount > 0 && (
          <div className="bg-surface-hover rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-[#8B949E]">Total:</span>
              <span className="text-[#E6EDF3]">{formatCurrency(totalAmount)}</span>
            </div>
            {paidAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#8B949E]">{isIncome ? 'Cobrado' : 'Pagado'}:</span>
                <span className="text-green-400">{formatCurrency(paidAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1">
              <span className="text-[#8B949E]">Pendiente:</span>
              <span className={pendingAmount > 0 ? 'text-amber-400' : 'text-green-400'}>
                {formatCurrency(pendingAmount)}
              </span>
            </div>
          </div>
        )}

        {/* Cuenta */}
        <div>
          <label className="block text-sm text-[#8B949E] mb-1">
            Cuenta {isIncome ? 'de destino' : 'de origen'} *
          </label>
          <select
            value={form.accountId}
            onChange={(e) => handleAccountChange(e.target.value)}
            className="input w-full"
            required
            data-testid="payment-modal-account"
          >
            <option value="">Seleccionar cuenta</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({formatCurrency(a.currentBalance)})
              </option>
            ))}
          </select>
        </div>

        {/* Monto */}
        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Monto *</label>
          <input
            type="number"
            value={form.amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            className="input w-full"
            min="1"
            max={pendingAmount > 0 ? pendingAmount : undefined}
            required
          />
          {pendingAmount > 0 && (
            <button
              type="button"
              onClick={() => handleAmountChange(pendingAmount.toString())}
              className="text-xs text-accent hover:underline mt-1"
            >
              Usar monto pendiente
            </button>
          )}
        </div>

        {/* Fecha */}
        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Fecha</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="input w-full"
          />
        </div>

        {/* Descripcion */}
        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Descripcion</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="input w-full"
            placeholder="Opcional"
          />
        </div>

        {/* Warning */}
        {warning && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-400">
            {warning}
          </div>
        )}

        {/* Botones */}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost flex-1"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className={`btn-primary flex-1 ${isIncome ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
            disabled={loading || !form.accountId || !form.amount}
            data-testid="payment-modal-submit"
          >
            {loading ? 'Procesando...' : isIncome ? 'Registrar Cobro' : 'Registrar Pago'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
