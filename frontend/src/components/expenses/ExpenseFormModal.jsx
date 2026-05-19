import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/contexts/AppContext';
import { EXPENSE_CATEGORIES, getLocalDateString, formatCurrency } from '@/lib/constants';
import { accountsApi, thirdPartiesApi } from '@/lib/treasuryApi';
import Modal from '@/components/shared/Modal';
import { Input, Select, Textarea, Checkbox } from '@/components/shared/FormFields';

export default function ExpenseFormModal({ vehicleId, expense, onClose }) {
  const navigate = useNavigate();
  const { createExpense, updateExpense, vehicles, fetchVehicles } = useApp();
  const [accounts, setAccounts] = useState([]);
  const [thirdParties, setThirdParties] = useState([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const isEdit = !!expense;
  const lockedAmountAndAccount = useMemo(() => {
    // CxP con pagos parciales: el backend bloquea cambios a amount/account
    if (!isEdit || !expense?.payable) return false;
    return parseFloat(expense.payable.paidAmount || 0) > 0;
  }, [isEdit, expense]);

  const [f, setF] = useState(() => ({
    vehicleId: expense?.vehicleId || vehicleId || '',
    category: expense?.category || 'MECANICA',
    amount: expense?.amount != null ? String(expense.amount) : '',
    description: expense?.description || '',
    notes: expense?.notes || '',
    date: expense?.date ? expense.date.slice(0, 10) : getLocalDateString(),
    isPaid: expense ? !!expense.paid : true,
    accountId: expense?.accountId || '',
    thirdPartyId: '',
    dueDate: expense?.payable?.dueDate ? expense.payable.dueDate.slice(0, 10) : '',
    reason: '',
  }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!vehicleId && !isEdit && vehicles.length === 0) fetchVehicles();
    (async () => {
      try {
        const [accRes, tpRes] = await Promise.all([
          accountsApi.getAll({ isActive: true }),
          thirdPartiesApi.getAll(),
        ]);
        const activeAccounts = (accRes.data || []).filter(a => a.isActive);
        setAccounts(activeAccounts);
        setThirdParties(tpRes.data || []);
        if (!isEdit && activeAccounts.length === 1) setF(p => ({ ...p, accountId: activeAccounts[0].id }));
      } finally {
        setAccountsLoaded(true);
      }
    })();
  }, [vehicleId, vehicles.length, fetchVehicles, isEdit]);

  const noAccounts = accountsLoaded && accounts.length === 0;
  const selectedAccount = accounts.find(a => a.id === f.accountId);

  const canSubmit =
    !noAccounts &&
    !!f.amount &&
    !!f.accountId &&
    (vehicleId || isEdit || !!f.vehicleId);

  // Cómputo del delta para mostrar warning de ajuste en edit mode
  const adjustmentDelta = useMemo(() => {
    if (!isEdit || !expense?.paid) return null;
    const oldAmt = parseFloat(expense.amount);
    const newAmt = parseFloat(f.amount);
    if (Number.isNaN(newAmt) || newAmt === oldAmt) return null;
    return newAmt - oldAmt;
  }, [isEdit, expense, f.amount]);

  const accountChanged = isEdit && f.accountId && f.accountId !== expense.accountId;

  const handleSave = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      if (isEdit) {
        const payload = {
          category: f.category,
          amount: parseFloat(f.amount) || 0,
          description: f.description || null,
          notes: f.notes || null,
          date: f.date || null,
          accountId: f.accountId,
        };
        await updateExpense(expense.id, payload, { reason: f.reason || undefined });
      } else {
        await createExpense({
          vehicleId: f.vehicleId || vehicleId,
          category: f.category,
          amount: parseFloat(f.amount) || 0,
          description: f.description || null,
          notes: f.notes || null,
          date: f.date || null,
          isPaid: f.isPaid,
          accountId: f.accountId,
          thirdPartyId: f.thirdPartyId || null,
          dueDate: f.isPaid ? null : (f.dueDate || null),
        });
      }
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} title={isEdit ? 'Editar gasto' : 'Registrar Gasto'} width="max-w-md">
      {noAccounts ? (
        <div className="rounded-lg border border-[#F85149]/40 bg-[#F85149]/10 p-4 text-sm">
          <div className="font-semibold text-[#F85149] mb-2">No hay cuentas de tesorería activas</div>
          <p className="text-[#E6EDF3]/80 mb-3">
            Debes crear al menos una cuenta antes de registrar un gasto.
          </p>
          <button
            className="btn-primary"
            onClick={() => { onClose(); navigate('/treasury/accounts'); }}
          >
            Crear cuenta de tesorería
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {!vehicleId && !isEdit && (
            <Select label="Vehículo *" value={f.vehicleId} onChange={e => s('vehicleId', e.target.value)}
              options={[{ value: '', label: 'Seleccionar...' }, ...vehicles.map(v => ({ value: v.id, label: `${v.plate} — ${v.brand} ${v.model}` }))]} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select label="Categoría" value={f.category} onChange={e => s('category', e.target.value)}
              options={EXPENSE_CATEGORIES.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` }))} />
            <Input
              label={`Valor *${lockedAmountAndAccount ? ' (bloqueado)' : ''}`}
              type="number"
              value={f.amount}
              onChange={e => s('amount', e.target.value)}
              placeholder="150000"
              disabled={lockedAmountAndAccount}
            />
          </div>

          <Input label="Descripción" value={f.description} onChange={e => s('description', e.target.value)} placeholder="Bujías y mano de obra" />
          <Textarea label="Notas adicionales" rows={2} value={f.notes} onChange={e => s('notes', e.target.value)} placeholder="Detalles extra, observaciones..." />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label={`Cuenta de tesorería *${lockedAmountAndAccount ? ' (bloqueada)' : ''}`}
              value={f.accountId}
              onChange={e => s('accountId', e.target.value)}
              disabled={lockedAmountAndAccount}
              options={[
                { value: '', label: 'Seleccionar...' },
                ...accounts.map(a => ({ value: a.id, label: `${a.name} (${formatCurrency(a.currentBalance || 0)})` })),
              ]}
            />
            {!isEdit && (
              <Select
                label="Proveedor / Tercero"
                value={f.thirdPartyId}
                onChange={e => s('thirdPartyId', e.target.value)}
                options={[
                  { value: '', label: 'Sin especificar' },
                  ...thirdParties
                    .filter(t => ['SUPPLIER', 'BOTH'].includes(t.type))
                    .map(t => ({ value: t.id, label: t.name })),
                ]}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <Input label="Fecha" type="date" value={f.date} onChange={e => s('date', e.target.value)} />
            {!isEdit && (
              <Checkbox label="Pagado (descuenta de la cuenta)" checked={f.isPaid} onChange={e => s('isPaid', e.target.checked)} className="pb-2" />
            )}
          </div>

          {!isEdit && !f.isPaid && (
            <Input label="Fecha de vencimiento (CxP)" type="date" value={f.dueDate} onChange={e => s('dueDate', e.target.value)} />
          )}

          {lockedAmountAndAccount && (
            <div className="text-[12px] text-[#D29922] bg-[#D29922]/10 border border-[#D29922]/30 rounded-lg p-2.5">
              El monto y la cuenta no se pueden modificar: el gasto tiene pagos parciales en su CxP.
            </div>
          )}

          {isEdit && expense?.paid && (adjustmentDelta != null || accountChanged) && (
            <div className="text-[12px] text-[#D29922] bg-[#D29922]/10 border border-[#D29922]/30 rounded-lg p-2.5">
              {accountChanged
                ? `Se generarán 2 movimientos de ajuste: reverso en la cuenta actual y cargo en la nueva.`
                : `Se generará un movimiento de ajuste de ${formatCurrency(Math.abs(adjustmentDelta))} en la cuenta.`}
            </div>
          )}

          {isEdit && (
            <Textarea
              label="Motivo del cambio (opcional)"
              value={f.reason}
              onChange={(e) => s('reason', e.target.value)}
              rows={2}
              placeholder="Por qué se está editando..."
            />
          )}

          {!isEdit && f.isPaid && selectedAccount && f.amount && Number(f.amount) > Number(selectedAccount.currentBalance || 0) && (
            <div className="text-[11px] text-[#D29922]">
              ⚠️ La cuenta quedará con saldo negativo después de este gasto.
            </div>
          )}

          {error && (
            <div className="text-[12px] text-[#F85149] bg-[#F85149]/10 border border-[#F85149]/30 rounded-lg p-2.5">
              {error}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="btn-ghost" disabled={loading}>Cancelar</button>
        {!noAccounts && (
          <button onClick={handleSave} disabled={loading || !canSubmit} className="btn-primary" data-testid="expense-form-submit">
            {loading ? 'Guardando...' : (isEdit ? 'Guardar cambios' : 'Registrar Gasto')}
          </button>
        )}
      </div>
    </Modal>
  );
}
