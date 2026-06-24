// ═══════════════════════════════════════════════════════════════
// Transactions Page — Listado y registro de movimientos
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { transactionsApi, accountsApi, thirdPartiesApi, transfersApi } from '@/lib/treasuryApi';
import { formatCurrency, formatDateTime, getLocalDateString } from '@/lib/constants';
import { ArrowLeftRight } from 'lucide-react';
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

const CATEGORY_LABELS = {
  VEHICLE_PURCHASE: 'Compra de Vehículo',
  VEHICLE_SALE: 'Venta de Vehículo',
  VEHICLE_SALE_PARTIAL: 'Abono de Venta',
  VEHICLE_EXPENSE: 'Gasto de Vehículo',
  FIXED_EXPENSE: 'Gasto Fijo',
  OPERATING_EXPENSE: 'Gasto Operativo',
  COMMISSION: 'Comisión',
  CAPITAL_CONTRIBUTION: 'Aporte de Capital',
  OTHER_INCOME: 'Otro Ingreso',
  OTHER_EXPENSE: 'Otro Gasto',
  TRANSFER: 'Transferencia',
  EXPENSE_ADJUSTMENT: 'Ajuste de Gasto',
  EXPENSE_REVERSAL: 'Reverso de Gasto',
  MANUAL_REVERSAL: 'Reverso de Movimiento',
};

const getCategoryLabel = (category) => CATEGORY_LABELS[category] || category || '—';

// Badges para movimientos derivados: edición o borrado de un gasto crea
// EXPENSE_ADJUSTMENT / EXPENSE_REVERSAL con reversesTransactionId apuntando
// al VEHICLE_EXPENSE original. La UI los marca con color para que el usuario
// los distinga de un movimiento normal.
const ORIGIN_BADGE = {
  EXPENSE_ADJUSTMENT: {
    label: 'Ajuste',
    className: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  EXPENSE_REVERSAL: {
    label: 'Reverso',
    className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  },
  MANUAL_REVERSAL: {
    label: 'Reverso',
    className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  },
};

const shortId = (id) => (id ? `#${id.slice(-6)}` : '');

const LINKED_FIELDS = ['expenseId', 'loanId', 'loanPaymentId', 'debtId', 'transferId'];

const isReversed = (tx) => tx.reversedBy && tx.reversedBy.length > 0;

export default function TransactionsPage() {
  const { role } = useAuth();
  const isViewer = role === 'VIEWER';
  const isAdmin = role === 'ADMIN';
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reverseReason, setReverseReason] = useState('');

  const canReverse = (tx) =>
    isAdmin &&
    (tx.type === 'INCOME' || tx.type === 'EXPENSE') &&
    !tx.reversesTransactionId &&
    !tx.payablePayment &&
    !LINKED_FIELDS.some((f) => tx[f]) &&
    !(tx.reversedBy && tx.reversedBy.length > 0);

  const openReverseModal = (tx) => {
    setReverseTarget(tx);
    setReverseReason('');
  };

  const handleReverse = async () => {
    if (!reverseTarget || reverseReason.trim().length < 10) return;
    try {
      await transactionsApi.reverse(reverseTarget.id, reverseReason.trim());
      setReverseTarget(null);
      setReverseReason('');
      loadTransactions();
      loadAccounts();
    } catch (err) {
      console.error('Error reversing transaction:', err);
      alert(err.response?.data?.error || 'No se pudo reversar el movimiento');
    }
  };

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
    date: getLocalDateString(),
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
      date: getLocalDateString(),
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
        {!isViewer && (
          <div className="flex gap-2">
            <button onClick={() => openModal('income')} className="btn-primary text-sm bg-green-600 hover:bg-green-700">+ Ingreso</button>
            <button onClick={() => openModal('expense')} className="btn-primary text-sm bg-red-600 hover:bg-red-700">+ Egreso</button>
            <button onClick={() => openModal('transfer')} className="btn-ghost text-sm" data-testid="transactions-transfer-button"><span className="inline-flex items-center gap-1.5"><ArrowLeftRight className="w-3.5 h-3.5" /> Transferencia</span></button>
          </div>
        )}
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
              <th className="text-left p-3">Placa</th>
              <th className="text-left p-3">Categoria</th>
              <th className="text-left p-3 hidden lg:table-cell">Descripcion</th>
              <th className="text-right p-3">Monto</th>
              <th className="text-right p-3"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className="border-t border-border hover:bg-surface-hover">
                <td className="p-3 text-[#8B949E] whitespace-nowrap">{formatDateTime(tx.createdAt)}</td>
                <td className="p-3">
                  <span className={`text-xs font-medium ${getTypeColor(tx.type)}`}>
                    {getTypeLabel(tx.type)}
                  </span>
                </td>
                <td className="p-3 text-[#E6EDF3] hidden md:table-cell">{tx.account?.name}</td>
                <td className="p-3">
                  {tx.vehicle?.plate ? (
                    <span className="plate-badge inline-block px-2 py-0.5 rounded font-mono text-xs font-semibold bg-[#1F6FEB]/15 text-[#58A6FF]">
                      {tx.vehicle.plate}
                    </span>
                  ) : (
                    <span className="text-[#6E7681] text-xs">—</span>
                  )}
                </td>
                <td className="p-3 text-[#E6EDF3] text-xs">
                  <div className="flex items-center gap-2">
                    <span>{getCategoryLabel(tx.category)}</span>
                    {ORIGIN_BADGE[tx.category] && (
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${ORIGIN_BADGE[tx.category].className}`}
                        title={
                          tx.reversesTransactionId
                            ? `Derivado del movimiento ${shortId(tx.reversesTransactionId)}`
                            : 'Movimiento derivado de edición/borrado de un gasto'
                        }
                        data-testid={`origin-badge-${tx.category}`}
                      >
                        {ORIGIN_BADGE[tx.category].label}
                      </span>
                    )}
                    {isReversed(tx) && (
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-zinc-500/15 text-zinc-300 border-zinc-500/30"
                        data-testid={`reversed-badge-${tx.id}`}
                      >
                        Reversado
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-3 text-[#E6EDF3] hidden lg:table-cell truncate max-w-[280px]">
                  {tx.description || <span className="text-[#6E7681]">—</span>}
                  {tx.reversesTransactionId && (
                    <span className="ml-2 text-[10px] text-[#6E7681]" title={tx.reversesTransactionId}>
                      ← {shortId(tx.reversesTransactionId)}
                    </span>
                  )}
                </td>
                <td className={`p-3 text-right font-semibold whitespace-nowrap ${getTypeColor(tx.type)}`}>
                  {tx.type === 'INCOME' || tx.type === 'TRANSFER_IN' ? '+' : '-'}
                  {formatCurrency(tx.amount)}
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  {canReverse(tx) && (
                    <button
                      onClick={() => openReverseModal(tx)}
                      className="btn-ghost text-xs text-amber-400 hover:text-amber-300"
                      data-testid={`tx-reverse-${tx.id}`}
                    >
                      Reversar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan="8" className="p-6 text-center text-[#8B949E]">No hay movimientos</td>
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
                  data-testid="transfer-from-account"
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
                  data-testid="transfer-to-account"
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
              data-testid="transactions-modal-amount"
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Fecha</label>
            <div className="input w-full bg-[#0F1419] text-[#6E7681]">
              Se registra con la fecha y hora actual
            </div>
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
            <button type="submit" className="btn-primary flex-1" data-testid="transactions-modal-submit">Guardar</button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(reverseTarget)}
        onClose={() => {
          setReverseTarget(null);
          setReverseReason('');
        }}
        title="Reversar movimiento"
      >
        {reverseTarget && (
          <div className="space-y-4" data-testid="reverse-modal">
            <p className="text-sm text-[#8B949E]">
              Se creará un movimiento compensatorio que anula{' '}
              <span className="font-mono text-[#E6EDF3]">{shortId(reverseTarget.id)}</span>{' '}
              ({getCategoryLabel(reverseTarget.category)}, {formatCurrency(reverseTarget.amount)}).
              El movimiento original no se borra.
            </p>
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Motivo * (mín 10 caracteres)</label>
              <textarea
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="input w-full"
                rows={3}
                data-testid="reverse-reason"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => {
                setReverseTarget(null);
                setReverseReason('');
              }} className="btn-ghost flex-1">Cancelar</button>
              <button
                type="button"
                onClick={handleReverse}
                disabled={reverseReason.trim().length < 10}
                className="btn-primary flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                data-testid="reverse-confirm"
              >
                Reversar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
