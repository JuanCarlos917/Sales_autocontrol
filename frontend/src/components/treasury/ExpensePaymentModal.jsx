// ═══════════════════════════════════════════════════════════════
// ExpensePaymentModal — Modal para registrar gasto con pago
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import Modal from '@/components/shared/Modal';
import { accountsApi, thirdPartiesApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';

const EXPENSE_CATEGORIES = [
  { id: 'MECANICA', label: 'Mecanica' },
  { id: 'ESTETICA', label: 'Estetica' },
  { id: 'IMPUESTOS', label: 'Impuestos' },
  { id: 'TRAMITE', label: 'Tramite' },
  { id: 'PARQUEADERO', label: 'Parqueadero' },
  { id: 'PUBLICIDAD', label: 'Publicidad' },
  { id: 'COMBUSTIBLE', label: 'Combustible' },
  { id: 'OTRO', label: 'Otro' },
];

export default function ExpensePaymentModal({
  isOpen,
  onClose,
  onSubmit,
  vehicleId,
  vehiclePlate = '',
  loading = false,
}) {
  const [accounts, setAccounts] = useState([]);
  const [thirdParties, setThirdParties] = useState([]);
  const [isPaid, setIsPaid] = useState(true);
  const [warning, setWarning] = useState(null);
  const [form, setForm] = useState({
    category: 'MECANICA',
    amount: '',
    description: '',
    date: getLocalDateString(),
    accountId: '',
    thirdPartyId: '',
    dueDate: '',
  });

  useEffect(() => {
    if (isOpen) {
      loadData();
      resetForm();
    }
  }, [isOpen]);

  const loadData = async () => {
    try {
      const [accountsRes, thirdPartiesRes] = await Promise.all([
        accountsApi.getAll(),
        thirdPartiesApi.getAll(),
      ]);
      setAccounts(accountsRes.data.filter(a => a.isActive));
      setThirdParties(thirdPartiesRes.data.filter(tp => tp.type === 'SUPPLIER'));
      if (accountsRes.data.length > 0) {
        setForm(f => ({ ...f, accountId: accountsRes.data[0].id }));
      }
    } catch (err) {
      console.error('Error loading data:', err);
    }
  };

  const resetForm = () => {
    setIsPaid(true);
    setWarning(null);
    setForm({
      category: 'MECANICA',
      amount: '',
      description: '',
      date: getLocalDateString(),
      accountId: accounts[0]?.id || '',
      thirdPartyId: '',
      dueDate: '',
    });
  };

  const handleAmountChange = (value) => {
    setForm({ ...form, amount: value });
    checkBalance(form.accountId, value);
  };

  const handleAccountChange = (accountId) => {
    setForm({ ...form, accountId });
    checkBalance(accountId, form.amount);
  };

  const checkBalance = (accountId, amount) => {
    if (!isPaid || !accountId || !amount) {
      setWarning(null);
      return;
    }
    const account = accounts.find(a => a.id === accountId);
    const expenseAmount = parseFloat(amount) || 0;
    if (account && expenseAmount > parseFloat(account.currentBalance)) {
      setWarning({
        type: 'NEGATIVE_BALANCE',
        message: `La cuenta "${account.name}" quedará con saldo negativo`,
        currentBalance: parseFloat(account.currentBalance),
        newBalance: parseFloat(account.currentBalance) - expenseAmount
      });
    } else {
      setWarning(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.amount || !form.category) {
      alert('Monto y categoria son requeridos');
      return;
    }

    const data = {
      vehicleId,
      category: form.category,
      amount: parseFloat(form.amount),
      description: form.description || null,
      date: form.date || null,
      isPaid,
      accountId: form.accountId,
      thirdPartyId: form.thirdPartyId || null,
      dueDate: !isPaid && form.dueDate ? form.dueDate : null,
    };

    await onSubmit(data);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Nuevo Gasto${vehiclePlate ? ` - ${vehiclePlate}` : ''}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Categoria y Monto */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Categoria *</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="input w-full"
              required
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Monto *</label>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              className="input w-full"
              min="1"
              required
              data-testid="exp-tre-amount"
            />
          </div>
        </div>

        {/* Descripcion */}
        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Descripcion</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="input w-full"
            placeholder="Detalle del gasto"
          />
        </div>

        {/* Fecha y Proveedor */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Fecha</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Proveedor</label>
            <select
              value={form.thirdPartyId}
              onChange={(e) => setForm({ ...form, thirdPartyId: e.target.value })}
              className="input w-full"
            >
              <option value="">Sin proveedor</option>
              {thirdParties.map((tp) => (
                <option key={tp.id} value={tp.id}>{tp.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Pago */}
        <div className="border border-border rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-4">
            <span className="text-sm text-[#8B949E]">Estado del pago:</span>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="isPaid"
                checked={isPaid}
                onChange={() => { setIsPaid(true); setWarning(null); }}
                className="text-accent"
              />
              <span className="text-sm text-[#E6EDF3]">Pagado</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="isPaid"
                checked={!isPaid}
                onChange={() => { setIsPaid(false); setWarning(null); }}
                className="text-accent"
                data-testid="exp-tre-pending"
              />
              <span className="text-sm text-[#E6EDF3]">Pendiente (CxP)</span>
            </label>
          </div>

          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Cuenta de tesorería *</label>
            <select
              value={form.accountId}
              onChange={(e) => handleAccountChange(e.target.value)}
              className="input w-full"
              required
              data-testid="exp-tre-account"
            >
              <option value="">Seleccionar cuenta</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatCurrency(a.currentBalance)})
                </option>
              ))}
            </select>
            {!isPaid && (
              <p className="text-xs text-[#8B949E] mt-1">
                Cuenta asociada al gasto (se debitará cuando registres el pago de la CxP).
              </p>
            )}
          </div>

          {!isPaid && (
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Fecha de Vencimiento</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="input w-full"
              />
              <p className="text-xs text-amber-400 mt-1">
                Se creará una Cuenta por Pagar pendiente
              </p>
            </div>
          )}
        </div>

        {/* Warning */}
        {warning && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-400">
            {warning.message}
            <div className="text-xs mt-1 opacity-75">
              Saldo actual: {formatCurrency(warning.currentBalance)} →
              Nuevo saldo: {formatCurrency(warning.newBalance)}
            </div>
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
            className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
            disabled={loading || !form.amount || !form.category || !form.accountId}
            data-testid="exp-tre-submit"
          >
            {loading ? 'Procesando...' : 'Registrar Gasto'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
