import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/shared/Modal';
import { debtsApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';

const FREQUENCIES = [
  { id: 'MONTHLY', label: 'Mensual', addMonths: 1 },
  { id: 'BIWEEKLY', label: 'Quincenal', addDays: 15 },
  { id: 'WEEKLY', label: 'Semanal', addDays: 7 },
];

function addInterval(date, freq) {
  const d = new Date(date);
  if (freq.addMonths) d.setMonth(d.getMonth() + freq.addMonths);
  else if (freq.addDays) d.setDate(d.getDate() + freq.addDays);
  return d.toISOString().slice(0, 10);
}

function generateInstallments(total, count, frequencyId, firstDate) {
  const freq = FREQUENCIES.find((f) => f.id === frequencyId) || FREQUENCIES[0];
  const t = parseFloat(total) || 0;
  const n = Math.max(1, parseInt(count, 10) || 1);
  const base = Math.floor(t / n);
  const remainder = t - base * n;
  const out = [];
  let date = firstDate || getLocalDateString();
  for (let i = 0; i < n; i++) {
    const planned = i === n - 1 ? base + remainder : base;
    out.push({ sequence: i + 1, dueDate: date, plannedAmount: planned });
    date = addInterval(date, freq);
  }
  return out;
}

export default function NewDebtModal({ isOpen, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [assetDescription, setAssetDescription] = useState('');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState(1);
  const [frequency, setFrequency] = useState('MONTHLY');
  const [firstDate, setFirstDate] = useState(getLocalDateString());
  const [installments, setInstallments] = useState([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(''); setLender(''); setAssetDescription(''); setTotal('');
    setCount(1); setFrequency('MONTHLY'); setFirstDate(getLocalDateString());
    setInstallments([]); setNotes(''); setError(null);
  }, [isOpen]);

  const totalSchedule = useMemo(
    () => installments.reduce((s, i) => s + (parseFloat(i.plannedAmount) || 0), 0),
    [installments],
  );
  const sumOk = installments.length > 0 && Math.abs(totalSchedule - (parseFloat(total) || 0)) < 0.01;

  const handleGenerate = () => setInstallments(generateInstallments(total, count, frequency, firstDate));
  const updateInstallment = (idx, key, value) =>
    setInstallments((prev) => prev.map((i, n) => (n === idx ? { ...i, [key]: value } : i)));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Ingresá un nombre para el crédito.');
    if (!sumOk) return setError('La suma de las cuotas debe coincidir con el total a pagar.');
    setLoading(true);
    try {
      await debtsApi.create({
        name,
        lender: lender || null,
        assetDescription: assetDescription || null,
        notes: notes || null,
        installments: installments.map((i) => ({
          sequence: i.sequence, dueDate: i.dueDate, plannedAmount: parseFloat(i.plannedAmount),
        })),
      });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear el crédito');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo crédito" width="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Nombre *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input w-full" required data-testid="debt-form-name" />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Acreedor</label>
            <input type="text" value={lender} onChange={(e) => setLender(e.target.value)} className="input w-full" placeholder="Banco / financiera" />
          </div>
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Activo financiado</label>
          <input type="text" value={assetDescription} onChange={(e) => setAssetDescription(e.target.value)} className="input w-full" placeholder="Opcional" />
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Total a pagar *</label>
            <input type="number" value={total} onChange={(e) => setTotal(e.target.value)} className="input w-full" min="1" required data-testid="debt-form-total" />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1"># Cuotas</label>
            <input type="number" value={count} onChange={(e) => setCount(e.target.value)} className="input w-full" min="1" data-testid="debt-form-installments-count" />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Frecuencia</label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="input w-full" data-testid="debt-form-frequency">
              {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Primera fecha</label>
            <input type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} className="input w-full" data-testid="debt-form-first-date" />
          </div>
        </div>

        <button type="button" onClick={handleGenerate} className="btn-ghost text-sm" data-testid="debt-form-generate">Generar cronograma</button>

        {installments.length > 0 && (
          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[#8B949E]">Suma cuotas:</span>
              <span className={sumOk ? 'text-green-400' : 'text-red-400'}>{formatCurrency(totalSchedule)}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-[#8B949E] text-xs"><tr><th className="text-left py-1">#</th><th className="text-left py-1">Fecha</th><th className="text-right py-1">Monto</th></tr></thead>
              <tbody>
                {installments.map((i, idx) => (
                  <tr key={i.sequence} className="border-t border-border">
                    <td className="py-1">{i.sequence}</td>
                    <td><input type="date" value={i.dueDate} onChange={(e) => updateInstallment(idx, 'dueDate', e.target.value)} className="input w-full text-sm" /></td>
                    <td><input type="number" value={i.plannedAmount} onChange={(e) => updateInstallment(idx, 'plannedAmount', e.target.value)} className="input w-full text-sm text-right" min="0" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Notas</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="input w-full" placeholder="Opcional" />
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={loading}>Cancelar</button>
          <button type="submit" className="btn-primary flex-1" disabled={loading || !sumOk} data-testid="debt-form-submit">{loading ? 'Creando...' : 'Crear crédito'}</button>
        </div>
      </form>
    </Modal>
  );
}
