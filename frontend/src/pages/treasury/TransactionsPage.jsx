// ═══════════════════════════════════════════════════════════════
// Transactions Page — Listado y registro de movimientos
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { transactionsApi, accountsApi, thirdPartiesApi, transfersApi } from '@/lib/treasuryApi';
import { formatCurrency, formatDate } from '@/lib/constants';
import Modal from '@/components/shared/Modal';

const INCOME_CATEGORIES = [
  { id: 'VEHICLE_SALE', label: 'Venta de Vehiculo' },
  { id: 'VEHICLE_SALE_PARTIAL', label: 'Abono de Venta' },
  { id: 'CAPITAL_CONTRIBUTION', label: 'Aporte de Capital' },
  { id: 'OTHER_INCOME', label: 'Otro Ingreso' },
];

const EXPENSE_CATEGORIES = [
  { id: 'VEHICLE_PURCHASE', label: 'Compra de Vehiculo' },
  { id: 'VEHICLE_EXPENSE', label: 'Gasto de Vehiculo' },
  { id: 'OPERATING_EXPENSE', label: 'Gasto Operativo' },
  { id: 'OTHER_EXPENSE', label: 'Otro Gasto' },
];

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [thirdParties, setThirdParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('income'); // income, expense, transfer
  const [filters, setFilters] = useState({ accountId: '', type: '', startDate: '', endDate: '' });
  const [form, setForm] = useState({
    accountId: '',
    category: '',
    amount: '',
    description: '',
    thirdPartyId: '',
    date: new Date().toISOString().split('T')[0],
    // Transfer fields
    fromAccountId: '',
    toAccountId: '',
  });

  useEffect(() => {
    const loadData = async () => {
      await loadAccounts();
      await loadThirdParties();
      await loadTransactions();
    };
    loadData();
  }, []);

  useEffect(() => {
    loadTransactions();
  }, [filters]);

  const loadTransactions = async () => {
    try {
      const params = {};
      if (filters.accountId) params.accountId = filters.accountId;
      if (filters.type) params.type = filters.type;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      const { data } = await transactionsApi.getAll(params);
      setTransactions(data.transactions || []);
    } catch (err) {
      console.error('Error loading transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const { data } = await accountsApi.getAll();
      setAccounts(data);
    } catch (err) {
      console.error('Error loading accounts:', err);
    }
  };

  const loadThirdParties = async () => {
    try {
      const { data } = await thirdPartiesApi.getAll();
      setThirdParties(data);
    } catch (err) {
      console.error('Error loading third parties:', err);
    }
  };

  const openModal = (type) => {
    if (accounts.length === 0) {
      alert('Primero debe crear al menos una cuenta');
      return;
    }
    setModalType(type);
    setForm({
      accountId: accounts[0]?.id || '',
      category: type === 'income' ? 'CAPITAL_CONTRIBUTION' : type === 'expense' ? 'OPERATING_EXPENSE' : '',
      amount: '',
      description: '',
      thirdPartyId: '',
      date: new Date().toISOString().split('T')[0],
      fromAccountId: accounts[0]?.id || '',
      toAccountId: accounts.length > 1 ? accounts[1]?.id : accounts[0]?.id || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (modalType === 'transfer') {
        await transfersApi.create({
          fromAccountId: form.fromAccountId,
          toAccountId: form.toAccountId,
          amount: parseFloat(form.amount),
          description: form.description || null,
          date: form.date || null,
        });
      } else {
        const data = {
          accountId: form.accountId,
          category: form.category,
          amount: parseFloat(form.amount),
          description: form.description || null,
          thirdPartyId: form.thirdPartyId || null,
          date: form.date || null,
        };
        if (modalType === 'income') {
          await transactionsApi.createIncome(data);
        } else {
          await transactionsApi.createExpense(data);
        }
      }
      setShowModal(false);
      loadTransactions();
      loadAccounts();
    } catch (err) {
      console.error('Error saving transaction:', err);
      console.error('Response data:', err.response?.data);
      const errorMsg = err.response?.data?.details
        ? err.response.data.details.map(d => d.message).join(', ')
        : err.response?.data?.error || 'Error al guardar';
      alert(errorMsg);
    }
  };

  const getTypeLabel = (type) => {
    const labels = { INCOME: 'Ingreso', EXPENSE: 'Egreso', TRANSFER_IN: 'Transferencia +', TRANSFER_OUT: 'Transferencia -' };
    return labels[type] || type;
  };

  const getTypeColor = (type) => {
    if (type === 'INCOME' || type === 'TRANSFER_IN') return 'text-green-400';
    return 'text-red-400';
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-[#8B949E]">Cargando...</div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-[#E6EDF3]">Movimientos</h2>
        <div className="flex gap-2">
          <button onClick={() => openModal('income')} className="btn-primary text-sm bg-green-600 hover:bg-green-700">+ Ingreso</button>
          <button onClick={() => openModal('expense')} className="btn-primary text-sm bg-red-600 hover:bg-red-700">+ Egreso</button>
          <button onClick={() => openModal('transfer')} className="btn-ghost text-sm">↔ Transferencia</button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filters.accountId}
          onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}
          className="input"
        >
          <option value="">Todas las cuentas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          className="input"
        >
          <option value="">Todos los tipos</option>
          <option value="INCOME">Ingresos</option>
          <option value="EXPENSE">Egresos</option>
        </select>
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
          className="input"
          placeholder="Desde"
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
          className="input"
          placeholder="Hasta"
        />
      </div>

      {/* Lista */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-hover text-[#8B949E]">
            <tr>
              <th className="text-left p-3">Fecha</th>
              <th className="text-left p-3">Tipo</th>
              <th className="text-left p-3 hidden md:table-cell">Cuenta</th>
              <th className="text-left p-3">Descripcion</th>
              <th className="text-right p-3">Monto</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className="border-t border-border hover:bg-surface-hover">
                <td className="p-3 text-[#8B949E]">{formatDate(tx.date)}</td>
                <td className="p-3">
                  <span className={`text-xs font-medium ${getTypeColor(tx.type)}`}>
                    {getTypeLabel(tx.type)}
                  </span>
                </td>
                <td className="p-3 text-[#E6EDF3] hidden md:table-cell">{tx.account?.name}</td>
                <td className="p-3 text-[#E6EDF3]">{tx.description || tx.category}</td>
                <td className={`p-3 text-right font-semibold ${getTypeColor(tx.type)}`}>
                  {tx.type === 'INCOME' || tx.type === 'TRANSFER_IN' ? '+' : '-'}
                  {formatCurrency(tx.amount)}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan="5" className="p-6 text-center text-[#8B949E]">No hay movimientos</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={modalType === 'income' ? 'Nuevo Ingreso' : modalType === 'expense' ? 'Nuevo Egreso' : 'Nueva Transferencia'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {modalType === 'transfer' ? (
            <>
              <div>
                <label className="block text-sm text-[#8B949E] mb-1">Cuenta Origen *</label>
                <select
                  value={form.fromAccountId}
                  onChange={(e) => setForm({ ...form, fromAccountId: e.target.value })}
                  className="input w-full"
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-[#8B949E] mb-1">Cuenta Destino *</label>
                <select
                  value={form.toAccountId}
                  onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}
                  className="input w-full"
                  required
                >
                  {accounts.filter(a => a.id !== form.fromAccountId).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm text-[#8B949E] mb-1">Cuenta *</label>
                <select
                  value={form.accountId}
                  onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                  className="input w-full"
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-[#8B949E] mb-1">Categoria *</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="input w-full"
                  required
                >
                  {(modalType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-[#8B949E] mb-1">Tercero</label>
                <select
                  value={form.thirdPartyId}
                  onChange={(e) => setForm({ ...form, thirdPartyId: e.target.value })}
                  className="input w-full"
                >
                  <option value="">Sin tercero</option>
                  {thirdParties.map((tp) => (
                    <option key={tp.id} value={tp.id}>{tp.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Monto *</label>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="input w-full"
              min="1"
              required
            />
          </div>
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
            <label className="block text-sm text-[#8B949E] mb-1">Descripcion</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input w-full"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-ghost flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1">Guardar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
