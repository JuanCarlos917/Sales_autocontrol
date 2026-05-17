import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/contexts/AppContext';
import { EXPENSE_CATEGORIES, getLocalDateString, formatCurrency } from '@/lib/constants';
import { accountsApi, thirdPartiesApi } from '@/lib/treasuryApi';
import Modal from '@/components/shared/Modal';
import { Input, Select, Textarea, Checkbox } from '@/components/shared/FormFields';

export default function ExpenseFormModal({ vehicleId, onClose }) {
  const navigate = useNavigate();
  const { createExpense, vehicles, fetchVehicles } = useApp();
  const [accounts, setAccounts] = useState([]);
  const [thirdParties, setThirdParties] = useState([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [f, setF] = useState({
    vehicleId: vehicleId || '',
    category: 'MECANICA',
    amount: '',
    description: '',
    notes: '',
    date: getLocalDateString(),
    isPaid: true,
    accountId: '',
    thirdPartyId: '',
    dueDate: '',
  });
  const [loading, setLoading] = useState(false);
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!vehicleId && vehicles.length === 0) fetchVehicles();
    (async () => {
      try {
        const [accRes, tpRes] = await Promise.all([
          accountsApi.getAll({ isActive: true }),
          thirdPartiesApi.getAll(),
        ]);
        const activeAccounts = (accRes.data || []).filter(a => a.isActive);
        setAccounts(activeAccounts);
        setThirdParties(tpRes.data || []);
        if (activeAccounts.length === 1) setF(p => ({ ...p, accountId: activeAccounts[0].id }));
      } finally {
        setAccountsLoaded(true);
      }
    })();
  }, [vehicleId, vehicles.length, fetchVehicles]);

  const noAccounts = accountsLoaded && accounts.length === 0;
  const selectedAccount = accounts.find(a => a.id === f.accountId);

  const canSubmit =
    !noAccounts &&
    !!f.amount &&
    !!f.accountId &&
    (vehicleId || !!f.vehicleId) &&
    (f.isPaid || !!f.dueDate || true);

  const handleSave = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
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
      onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <Modal onClose={onClose} title="Registrar Gasto" width="max-w-md">
      {noAccounts ? (
        <div className="rounded-lg border border-[#F85149]/40 bg-[#F85149]/10 p-4 text-sm">
          <div className="font-semibold text-[#F85149] mb-2">No hay cuentas de tesorería activas</div>
          <p className="text-[#E6EDF3]/80 mb-3">
            Debes crear al menos una cuenta antes de registrar un gasto. Cada gasto se descuenta
            de una cuenta de tesorería.
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
          {!vehicleId && (
            <Select label="Vehículo *" value={f.vehicleId} onChange={e => s('vehicleId', e.target.value)}
              options={[{ value: '', label: 'Seleccionar...' }, ...vehicles.map(v => ({ value: v.id, label: `${v.plate} — ${v.brand} ${v.model}` }))]} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select label="Categoría" value={f.category} onChange={e => s('category', e.target.value)}
              options={EXPENSE_CATEGORIES.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` }))} />
            <Input label="Valor *" type="number" value={f.amount} onChange={e => s('amount', e.target.value)} placeholder="150000" />
          </div>

          <Input label="Descripción" value={f.description} onChange={e => s('description', e.target.value)} placeholder="Bujías y mano de obra" />
          <Textarea label="Notas adicionales" rows={2} value={f.notes} onChange={e => s('notes', e.target.value)} placeholder="Detalles extra, observaciones..." />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Cuenta de tesorería *"
              value={f.accountId}
              onChange={e => s('accountId', e.target.value)}
              options={[
                { value: '', label: 'Seleccionar...' },
                ...accounts.map(a => ({ value: a.id, label: `${a.name} (${formatCurrency(a.currentBalance || 0)})` })),
              ]}
            />
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
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <Input label="Fecha" type="date" value={f.date} onChange={e => s('date', e.target.value)} />
            <Checkbox label="Pagado (descuenta de la cuenta)" checked={f.isPaid} onChange={e => s('isPaid', e.target.checked)} className="pb-2" />
          </div>

          {!f.isPaid && (
            <Input label="Fecha de vencimiento (CxP)" type="date" value={f.dueDate} onChange={e => s('dueDate', e.target.value)} />
          )}

          {f.isPaid && selectedAccount && f.amount && Number(f.amount) > Number(selectedAccount.currentBalance || 0) && (
            <div className="text-[11px] text-[#D29922]">
              ⚠️ La cuenta quedará con saldo negativo después de este gasto.
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="btn-ghost">Cancelar</button>
        {!noAccounts && (
          <button onClick={handleSave} disabled={loading || !canSubmit} className="btn-primary">
            {loading ? 'Guardando...' : 'Registrar Gasto'}
          </button>
        )}
      </div>
    </Modal>
  );
}
