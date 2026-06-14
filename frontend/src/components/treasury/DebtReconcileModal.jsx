import { useEffect, useState } from 'react';
import Modal from '@/components/shared/Modal';
import { debtsApi } from '@/lib/treasuryApi';
import { formatCurrency, formatDate } from '@/lib/constants';

export default function DebtReconcileModal({ isOpen, onClose, onDone, debt }) {
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelected({}); setSearch(''); setError(null);
    debtsApi.reconcileCandidates().then((res) => setCandidates(res.data));
  }, [isOpen]);

  const doSearch = async () => {
    const res = await debtsApi.reconcileCandidates({ search: search || undefined });
    setCandidates(res.data);
  };

  const toggle = (id) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const selectedTotal = candidates.filter((c) => selected[c.id]).reduce((s, c) => s + parseFloat(c.amount), 0);

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return setError('Seleccioná al menos un egreso.');
    setError(null);
    setLoading(true);
    try {
      await debtsApi.reconcile(debt.id, { transactionIds: selectedIds });
      onDone?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al reconciliar');
    } finally {
      setLoading(false);
    }
  };

  if (!debt) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Reconciliar egresos → ${debt.name}`} width="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-[#8B949E]">Seleccioná los egresos históricos que correspondan a cuotas de este crédito. Se enlazan sin mover plata y se reclasifican como pago del crédito.</p>

        <div className="flex gap-2">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} className="input flex-1" placeholder="Buscar por descripción (ej. pago cuota)" data-testid="debt-reconcile-search" />
          <button type="button" onClick={doSearch} className="btn-ghost">Buscar</button>
        </div>

        <div className="border border-border rounded-lg max-h-80 overflow-y-auto divide-y divide-border">
          {candidates.length === 0 ? (
            <div className="p-4 text-sm text-[#6E7681] text-center">Sin egresos candidatos.</div>
          ) : candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-3 p-3 text-sm cursor-pointer hover:bg-surface-hover" data-testid={`debt-reconcile-row-${c.id}`}>
              <input type="checkbox" checked={!!selected[c.id]} onChange={() => toggle(c.id)} />
              <span className="flex-1">{c.description || 'Egreso'} <span className="text-[#6E7681]">· {c.account?.name} · {formatDate(c.date)}</span></span>
              <span className="font-mono">{formatCurrency(c.amount)}</span>
            </label>
          ))}
        </div>

        <div className="flex justify-between text-sm"><span className="text-[#8B949E]">Seleccionado:</span><span className="font-mono text-[#E6EDF3]">{formatCurrency(selectedTotal)}</span></div>

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={loading}>Cancelar</button>
          <button type="button" onClick={handleSubmit} className="btn-primary flex-1" disabled={loading || selectedIds.length === 0} data-testid="debt-reconcile-submit">{loading ? 'Enlazando...' : 'Enlazar seleccionados'}</button>
        </div>
      </div>
    </Modal>
  );
}
