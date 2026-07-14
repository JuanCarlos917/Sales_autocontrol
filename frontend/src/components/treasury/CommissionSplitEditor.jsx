// ═══════════════════════════════════════════════════════════════
// CommissionSplitEditor — filas de reparto de comisión (persona+rol+%)
// Compartido entre Settings (equipo default) y SalePaymentModal (por venta).
// La parte del dueño es SIEMPRE el resto: se muestra en vivo, no es fila.
// ═══════════════════════════════════════════════════════════════

import ThirdPartySelector from '@/components/shared/ThirdPartySelector';
import { Plus, X } from 'lucide-react';

const MAX_PEOPLE = 5;
const ROLES = [
  { id: 'CAPTADOR', label: 'Captador' },
  { id: 'CERRADOR', label: 'Cerrador' },
  { id: 'OTHER', label: 'Otro' },
];

export default function CommissionSplitEditor({ value = [], onChange, testidPrefix }) {
  const sum = value.reduce((s, r) => s + (parseFloat(r.sharePct) || 0), 0);
  const ownerShare = Math.round((100 - sum) * 100) / 100;

  const setRow = (i, patch) => {
    const next = value.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const addRow = () => onChange([...value, { _id: crypto.randomUUID(), thirdPartyId: '', role: 'OTHER', sharePct: '' }]);
  const removeRow = (i) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {value.map((row, i) => (
        <div key={row._id ?? i} className="grid grid-cols-[1fr_110px_70px_28px] gap-2 items-end">
          <ThirdPartySelector
            value={row.thirdPartyId}
            onChange={(id) => setRow(i, { thirdPartyId: id })}
            label={i === 0 ? 'Persona' : undefined}
            placeholder="Seleccionar..."
          />
          <div>
            {i === 0 && <label className="block text-sm text-[#8B949E] mb-1">Rol</label>}
            <select
              value={row.role}
              onChange={(e) => setRow(i, { role: e.target.value })}
              className="input w-full"
              aria-label="Rol"
            >
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div>
            {i === 0 && <label className="block text-sm text-[#8B949E] mb-1">%</label>}
            <input
              type="number" min="1" max="100"
              value={row.sharePct}
              onChange={(e) => setRow(i, { sharePct: e.target.value })}
              className="input w-full"
              aria-label="Porcentaje"
              data-testid={`${testidPrefix}-row-${i}-pct`}
            />
          </div>
          <button
            type="button"
            onClick={() => removeRow(i)}
            className="btn-ghost p-1 text-red-400 hover:text-red-300"
            aria-label="Quitar persona"
            data-testid={`${testidPrefix}-remove-${i}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={addRow}
          disabled={value.length >= MAX_PEOPLE}
          className="btn-ghost text-xs inline-flex items-center gap-1 disabled:opacity-40"
          data-testid={`${testidPrefix}-add`}
        >
          <Plus className="w-3.5 h-3.5" /> Agregar persona ({value.length}/{MAX_PEOPLE})
        </button>
        <span
          className={`text-sm font-semibold ${ownerShare < 0 ? 'text-red-400' : 'text-[#3FB950]'}`}
          data-testid={`${testidPrefix}-owner-share`}
        >
          Tu parte: {ownerShare}%
        </span>
      </div>
    </div>
  );
}
