// ═══════════════════════════════════════════════════════════════
// Accounts Page — CRUD de cuentas
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { accountsApi } from '@/lib/treasuryApi';
import { formatCurrency } from '@/lib/constants';
import Modal from '@/components/shared/Modal';
import ReverseAction from '@/components/shared/ReverseAction';
import ReversedBadge from '@/components/shared/ReversedBadge';
import { useAuth } from '@/contexts/AuthContext';
import { Banknote, Landmark, PiggyBank } from 'lucide-react';

const ACCOUNT_TYPES = [
  { id: 'CASH', label: 'Efectivo / Caja' },
  { id: 'BANK', label: 'Cuenta de Ahorros' },
];

export default function AccountsPage() {
  const { isViewer } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'CASH', bank: '', accountNumber: '', initialBalance: 0 });

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const { data } = await accountsApi.getAll();
      setAccounts(data);
    } catch (err) {
      console.error('Error loading accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', type: 'CASH', bank: '', accountNumber: '', initialBalance: 0 });
    setShowModal(true);
  };

  const openEdit = (account) => {
    setEditing(account);
    setForm({
      name: account.name,
      type: account.type,
      bank: account.bank || '',
      accountNumber: account.accountNumber || '',
      initialBalance: parseFloat(account.initialBalance) || 0,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await accountsApi.update(editing.id, form);
      } else {
        await accountsApi.create(form);
      }
      setShowModal(false);
      loadAccounts();
    } catch (err) {
      console.error('Error saving account:', err);
      alert(err.response?.data?.error || 'Error al guardar');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar esta cuenta?')) return;
    try {
      await accountsApi.delete(id);
      loadAccounts();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-[#8B949E]">Cargando...</div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[#E6EDF3]">Cuentas</h2>
        {!isViewer && (
          <button onClick={openCreate} className="btn-primary text-sm">+ Nueva Cuenta</button>
        )}
      </div>

      {(() => {
        const cashAccounts = accounts.filter((a) => a.type === 'CASH');
        const bankAccounts = accounts.filter((a) => a.type === 'BANK');
        const budgetAccounts = accounts.filter((a) => a.type === 'BUDGET');

        const renderCard = (account) => (
          <div key={account.id} className={`card p-4 ${account.isActive === false ? 'opacity-60' : ''}`} data-testid={`account-card-${account.id}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-lg font-semibold text-[#E6EDF3]">{account.name}</span>
              <div className="flex items-center gap-1.5">
                {account.isActive === false && (
                  <ReversedBadge label="Inactiva" variant="red" testid={`account-${account.id}-inactive`} />
                )}
                <span className={`text-xs px-2 py-0.5 rounded ${
                  account.type === 'CASH'
                    ? 'bg-green-500/20 text-green-400'
                    : account.type === 'BANK'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-purple-500/20 text-[#BC8CFF]'
                }`}>
                  {account.type === 'CASH' ? 'Efectivo' : account.type === 'BANK' ? 'Banco' : 'Fondo'}
                </span>
              </div>
            </div>
            {account.bank && <div className="text-sm text-[#8B949E] mb-1">{account.bank}</div>}
            {account.accountNumber && <div className="text-xs text-[#6E7681] mb-2">No. {account.accountNumber}</div>}
            <div className="text-2xl font-bold text-[#E6EDF3] mb-3">
              {formatCurrency(account.currentBalance)}
            </div>
            {!isViewer && account.isActive !== false && (
              <div className="flex flex-wrap gap-2 items-center">
                <button onClick={() => openEdit(account)} className="btn-ghost text-xs flex-1">Editar</button>
                <ReverseAction
                  label="Desactivar"
                  title="Desactivar cuenta"
                  description={<>La cuenta se marcará como inactiva. Solo es posible si su saldo es cero y no tiene movimientos registrados.</>}
                  confirmLabel="Desactivar"
                  variant="amber"
                  testid={`account-${account.id}`}
                  onConfirm={(reason) => accountsApi.reverseAccount(account.id, reason)}
                  onDone={loadAccounts}
                />
                <button onClick={() => handleDelete(account.id)} className="btn-ghost text-xs text-red-400 hover:text-red-300">Eliminar</button>
              </div>
            )}
          </div>
        );

        return (
          <div className="space-y-8">
            {cashAccounts.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-[#E6EDF3] mb-3 inline-flex items-center gap-2"><Banknote className="w-5 h-5" /> Efectivo</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {cashAccounts.map(renderCard)}
                </div>
              </section>
            )}

            {bankAccounts.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-[#E6EDF3] mb-3 inline-flex items-center gap-2"><Landmark className="w-5 h-5" /> Bancos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {bankAccounts.map(renderCard)}
                </div>
              </section>
            )}

            {budgetAccounts.length > 0 && (
              <section>
                <h3 className="text-lg font-semibold text-[#BC8CFF] mb-1 inline-flex items-center gap-2"><PiggyBank className="w-5 h-5" /> Fondos / Reservas</h3>
                <p className="text-sm text-[#8B949E] mb-3">
                  Estas cuentas no son operativas: guardan los aportes automáticos de cada venta (reinversión, impuestos).
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {budgetAccounts.map(renderCard)}
                </div>
              </section>
            )}
          </div>
        );
      })()}

      {/* Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar Cuenta' : 'Nueva Cuenta'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Nombre *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Tipo *</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="input w-full"
              disabled={editing}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          {form.type === 'BANK' && (
            <>
              <div>
                <label className="block text-sm text-[#8B949E] mb-1">Banco</label>
                <input
                  type="text"
                  value={form.bank}
                  onChange={(e) => setForm({ ...form, bank: e.target.value })}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-[#8B949E] mb-1">Numero de Cuenta</label>
                <input
                  type="text"
                  value={form.accountNumber}
                  onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                  className="input w-full"
                />
              </div>
            </>
          )}
          {!editing && (
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Saldo Inicial</label>
              <input
                type="number"
                value={form.initialBalance}
                onChange={(e) => setForm({ ...form, initialBalance: parseFloat(e.target.value) || 0 })}
                className="input w-full"
                min="0"
              />
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-ghost flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1">Guardar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
