import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/shared/Modal';
import ThirdPartySelector from '@/components/shared/ThirdPartySelector';
import { accountsApi, loansApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';

const FREQUENCIES = [
  { id: 'MONTHLY', label: 'Mensual', addMonths: 1 },
  { id: 'BIWEEKLY', label: 'Quincenal', addDays: 15 },
  { id: 'WEEKLY', label: 'Semanal', addDays: 7 },
];

function addInterval(date, freq) {
  const d = new Date(date);
  if (freq.addMonths) {
    d.setMonth(d.getMonth() + freq.addMonths);
  } else if (freq.addDays) {
    d.setDate(d.getDate() + freq.addDays);
  }
  return d.toISOString().slice(0, 10);
}

function generateInstallments(principal, count, frequencyId, firstDate) {
  const freq = FREQUENCIES.find((f) => f.id === frequencyId) || FREQUENCIES[0];
  const total = Math.round(parseFloat(principal) || 0);
  const n = Math.max(1, parseInt(count, 10) || 1);
  // COP entero: cuotas base enteras y el residuo va a la última — el backend
  // exige plannedAmount integer (auditoría 🟡 #12).
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  const out = [];
  let date = firstDate || getLocalDateString();
  for (let i = 0; i < n; i++) {
    const planned = i === n - 1 ? base + remainder : base;
    out.push({ sequence: i + 1, dueDate: date, plannedAmount: planned });
    date = addInterval(date, freq);
  }
  return out;
}

export default function NewLoanModal({ isOpen, onClose, onCreated }) {
  const [accounts, setAccounts] = useState([]);
  const [borrowerId, setBorrowerId] = useState('');
  const [originAccountId, setOriginAccountId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [count, setCount] = useState(1);
  const [frequency, setFrequency] = useState('MONTHLY');
  const [firstDate, setFirstDate] = useState(getLocalDateString());
  const [installments, setInstallments] = useState([]);
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setBorrowerId('');
    setPrincipal('');
    setInterestRate('');
    setCount(1);
    setFrequency('MONTHLY');
    setFirstDate(getLocalDateString());
    setInstallments([]);
    setDescription('');
    setNotes('');
    setError(null);
    accountsApi.getAll().then((res) => {
      const active = res.data.filter((a) => a.isActive);
      setAccounts(active);
      setOriginAccountId((curr) => curr || active[0]?.id || '');
    });
  }, [isOpen]);

  const totalSchedule = useMemo(
    () => installments.reduce((s, i) => s + (parseFloat(i.plannedAmount) || 0), 0),
    [installments],
  );

  const interestAmount = useMemo(() => {
    const p = parseFloat(principal) || 0;
    const r = parseFloat(interestRate) || 0;
    return Math.round((p * r) / 100);
  }, [principal, interestRate]);

  const totalToRepay = (parseFloat(principal) || 0) + interestAmount;

  const sumOk = installments.length > 0 && Math.abs(totalSchedule - totalToRepay) < 0.01;

  const handleGenerate = () => {
    setInstallments(generateInstallments(totalToRepay, count, frequency, firstDate));
  };

  const updateInstallment = (idx, key, value) => {
    setInstallments((prev) => prev.map((i, n) => (n === idx ? { ...i, [key]: value } : i)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!borrowerId) return setError('Seleccioná un deudor.');
    if (!originAccountId) return setError('Seleccioná una cuenta origen.');
    if (!sumOk) return setError('La suma de las cuotas debe coincidir con el monto del préstamo.');
    setLoading(true);
    try {
      const payload = {
        borrowerId,
        originAccountId,
        principalAmount: parseFloat(principal),
        interestRate: parseFloat(interestRate) || 0,
        description: description || null,
        notes: notes || null,
        installments: installments.map((i) => ({
          sequence: i.sequence,
          dueDate: i.dueDate,
          plannedAmount: parseFloat(i.plannedAmount),
        })),
      };
      const res = await loansApi.create(payload);
      onCreated?.(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear el préstamo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo préstamo" width="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <ThirdPartySelector
            value={borrowerId}
            onChange={setBorrowerId}
            label="Deudor"
            placeholder="Buscar o crear..."
            required
          />
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Cuenta origen *</label>
            <select
              value={originAccountId}
              onChange={(e) => setOriginAccountId(e.target.value)}
              className="input w-full"
              required
              data-testid="loan-form-account"
            >
              <option value="">Seleccionar cuenta</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Monto principal *</label>
            <input
              type="number"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              className="input w-full"
              min="1"
              required
              data-testid="loan-form-principal"
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Interés (%)</label>
            <input
              type="number"
              value={interestRate}
              onChange={(e) => setInterestRate(e.target.value)}
              className="input w-full"
              min="0"
              max="100"
              step="0.01"
              placeholder="0"
              data-testid="loan-form-interest-rate"
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1"># Cuotas</label>
            <input
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="input w-full"
              min="1"
              data-testid="loan-form-installments-count"
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Frecuencia</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="input w-full"
              data-testid="loan-form-frequency"
            >
              {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Primera fecha</label>
            <input
              type="date"
              value={firstDate}
              onChange={(e) => setFirstDate(e.target.value)}
              className="input w-full"
              data-testid="loan-form-first-date"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          className="btn-ghost text-sm"
          data-testid="loan-form-generate"
        >
          Generar cronograma
        </button>

        {installments.length > 0 && (
          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[#8B949E]">Suma cuotas:</span>
              <span className={sumOk ? 'text-green-400' : 'text-red-400'}>{formatCurrency(totalSchedule)}</span>
            </div>
            {interestAmount > 0 && (
              <div className="flex justify-between text-sm" data-testid="loan-form-interest-summary">
                <span className="text-[#8B949E]">Capital {formatCurrency(parseFloat(principal) || 0)} + interés {formatCurrency(interestAmount)}:</span>
                <span className="text-[#E6EDF3] font-semibold">Total {formatCurrency(totalToRepay)}</span>
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="text-[#8B949E] text-xs">
                <tr>
                  <th className="text-left py-1">#</th>
                  <th className="text-left py-1">Fecha</th>
                  <th className="text-right py-1">Monto</th>
                </tr>
              </thead>
              <tbody>
                {installments.map((i, idx) => (
                  <tr key={i.sequence} className="border-t border-border">
                    <td className="py-1">{i.sequence}</td>
                    <td>
                      <input
                        type="date"
                        value={i.dueDate}
                        onChange={(e) => updateInstallment(idx, 'dueDate', e.target.value)}
                        className="input w-full text-sm"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={i.plannedAmount}
                        onChange={(e) => updateInstallment(idx, 'plannedAmount', e.target.value)}
                        className="input w-full text-sm text-right"
                        min="0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Descripción</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input w-full"
            placeholder="Opcional"
          />
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Notas</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input w-full"
            placeholder="Opcional"
          />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={loading}>Cancelar</button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={loading || !sumOk}
            data-testid="loan-form-submit"
          >
            {loading ? 'Creando...' : 'Crear préstamo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
