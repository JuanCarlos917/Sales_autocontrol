// ═══════════════════════════════════════════════════════════════
// CashCount Page — Arqueo de caja
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { cashCountsApi, accountsApi } from '@/lib/treasuryApi';
import { formatCurrency, formatDate } from '@/lib/constants';
import Modal from '@/components/shared/Modal';
import ReverseAction from '@/components/shared/ReverseAction';
import ReversedBadge from '@/components/shared/ReversedBadge';

export default function CashCountPage() {
  const [cashCounts, setCashCounts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [form, setForm] = useState({ accountId: '', countedBalance: '', notes: '' });

  useEffect(() => {
    Promise.all([loadCashCounts(), loadAccounts()]);
  }, []);

  const loadCashCounts = async () => {
    try {
      const { data } = await cashCountsApi.getAll({ limit: 50 });
      setCashCounts(data.cashCounts || []);
    } catch (err) {
      console.error('Error loading cash counts:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const { data } = await accountsApi.getAll();
      // Solo cuentas activas: no se hacen arqueos de cuentas inactivas.
      setAccounts(data.filter((a) => a.isActive !== false));
    } catch (err) {
      console.error('Error loading accounts:', err);
    }
  };

  const openModal = (account = null) => {
    setSelectedAccount(account);
    setForm({
      accountId: account?.id || accounts[0]?.id || '',
      countedBalance: '',
      notes: '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await cashCountsApi.create({
        accountId: form.accountId,
        countedBalance: parseFloat(form.countedBalance),
        notes: form.notes,
      });
      setShowModal(false);
      loadCashCounts();
      loadAccounts();
    } catch (err) {
      console.error('Error creating cash count:', err);
      alert(err.response?.data?.error || 'Error al guardar');
    }
  };

  const getDifferenceColor = (diff) => {
    const num = parseFloat(diff);
    if (num === 0) return 'text-green-400';
    if (num > 0) return 'text-blue-400';
    return 'text-red-400';
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-[#8B949E]">Cargando...</div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[#E6EDF3]">Arqueo de Caja</h2>
        <button onClick={() => openModal()} className="btn-primary text-sm">+ Nuevo Arqueo</button>
      </div>

      {/* Cuentas para arqueo rapido */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.filter(a => a.type === 'CASH').map((account) => (
          <div key={account.id} className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-[#E6EDF3]">{account.name}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">Efectivo</span>
            </div>
            <div className="text-xl font-bold text-[#E6EDF3] mb-3">
              {formatCurrency(account.currentBalance)}
            </div>
            <button
              onClick={() => openModal(account)}
              className="btn-ghost text-sm w-full"
            >
              Realizar Arqueo
            </button>
          </div>
        ))}
      </div>

      {/* Historial de arqueos */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-[#E6EDF3]">Historial de Arqueos</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface-hover text-[#8B949E]">
            <tr>
              <th className="text-left p-3">Fecha</th>
              <th className="text-left p-3">Cuenta</th>
              <th className="text-right p-3">Esperado</th>
              <th className="text-right p-3">Contado</th>
              <th className="text-right p-3">Diferencia</th>
              <th className="text-left p-3 hidden md:table-cell">Notas</th>
              <th className="text-right p-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cashCounts.map((cc) => (
              <tr
                key={cc.id}
                className={`border-t border-border hover:bg-surface-hover ${cc.voidedAt ? 'opacity-50' : ''}`}
                data-testid={`cashcount-row-${cc.id}`}
              >
                <td className="p-3 text-[#8B949E]">{formatDate(cc.date)}</td>
                <td className="p-3 text-[#E6EDF3]">{cc.account?.name}</td>
                <td className="p-3 text-right text-[#E6EDF3]">{formatCurrency(cc.expectedBalance)}</td>
                <td className="p-3 text-right text-[#E6EDF3]">{formatCurrency(cc.countedBalance)}</td>
                <td className={`p-3 text-right font-semibold ${getDifferenceColor(cc.difference)}`}>
                  {parseFloat(cc.difference) > 0 ? '+' : ''}{formatCurrency(cc.difference)}
                </td>
                <td className="p-3 text-[#8B949E] hidden md:table-cell">{cc.notes || '-'}</td>
                <td className="p-3 text-right">
                  {cc.voidedAt ? (
                    <ReversedBadge label="Anulado" variant="red" testid={`cashcount-${cc.id}-voided`} />
                  ) : (
                    <ReverseAction
                      label="Anular"
                      title="Anular arqueo"
                      description={<>El arqueo quedará anulado y dejará de contar como el último de la cuenta. No mueve dinero. Esta acción no se puede deshacer.</>}
                      confirmLabel="Anular arqueo"
                      variant="amber"
                      testid={`cashcount-${cc.id}`}
                      onConfirm={(reason) => cashCountsApi.reverse(cc.id, reason)}
                      onDone={() => { loadCashCounts(); loadAccounts(); }}
                    />
                  )}
                </td>
              </tr>
            ))}
            {cashCounts.length === 0 && (
              <tr>
                <td colSpan="7" className="p-6 text-center text-[#8B949E]">No hay arqueos registrados</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Nuevo Arqueo de Caja">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Cuenta *</label>
            <select
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
              className="input w-full"
              required
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} - Saldo: {formatCurrency(a.currentBalance)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Saldo Contado *</label>
            <input
              type="number"
              value={form.countedBalance}
              onChange={(e) => setForm({ ...form, countedBalance: e.target.value })}
              className="input w-full"
              min="0"
              required
              placeholder="Ingrese el monto contado fisicamente"
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Notas</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="input w-full"
              rows="2"
              placeholder="Observaciones del arqueo..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-ghost flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1">Registrar Arqueo</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
