// ═══════════════════════════════════════════════════════════════
// CommissionSplitEditor — filas de reparto de comisión (persona+rol+%)
// Compartido entre Settings (equipo default de vendedores + equipo de
// inversionistas) y SalePaymentModal (por venta).
//
// Modo default (vendedores): la parte del dueño es SIEMPRE el resto —
// se muestra en vivo, no es fila; el dueño (owner-self) no puede agregarse.
//
// Modo `requireExactSum` (inversionistas): el dueño SÍ puede ser una fila
// más (es un inversionista); no hay "resto automático" — la suma debe dar
// exactamente 100 (o quedar vacía) y se valida en vivo.
// ═══════════════════════════════════════════════════════════════

import ThirdPartySelector from '@/components/shared/ThirdPartySelector';
import { Plus, X } from 'lucide-react';

const MAX_PEOPLE = 5;
const DEFAULT_ROLES = [
  { id: 'CAPTADOR', label: 'Captador' },
  { id: 'CERRADOR', label: 'Cerrador' },
  { id: 'OTHER', label: 'Otro' },
];

export default function CommissionSplitEditor({
  value = [],
  onChange,
  testidPrefix,
  roles = DEFAULT_ROLES,
  requireExactSum = false,
  maxPeople = MAX_PEOPLE,
}) {
  const sum = value.reduce((s, r) => s + (parseFloat(r.sharePct) || 0), 0);
  const roundedSum = Math.round(sum * 100) / 100;
  const showRoleSelect = roles.length > 1;

  const setRow = (i, patch) => {
    const next = value.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const defaultRoleId = roles.find((r) => r.id === 'OTHER')?.id ?? roles[0].id;
  const addRow = () => onChange([...value, { _id: crypto.randomUUID(), thirdPartyId: '', role: defaultRoleId, sharePct: '' }]);
  const removeRow = (i) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {value.map((row, i) => (
        <div
          key={row._id ?? i}
          className={`grid gap-2 items-end ${showRoleSelect ? 'grid-cols-[1fr_110px_70px_28px]' : 'grid-cols-[1fr_70px_28px]'}`}
        >
          <ThirdPartySelector
            value={row.thirdPartyId}
            onChange={(id) => setRow(i, { thirdPartyId: id })}
            label={i === 0 ? 'Persona' : undefined}
            placeholder="Seleccionar..."
          />
          {showRoleSelect && (
            <div>
              {i === 0 && <label className="block text-sm text-[#8B949E] mb-1">Rol</label>}
              <select
                value={row.role}
                onChange={(e) => setRow(i, { role: e.target.value })}
                className="input w-full"
                aria-label="Rol"
              >
                {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          )}
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
          disabled={value.length >= maxPeople}
          className="btn-ghost text-xs inline-flex items-center gap-1 disabled:opacity-40"
          data-testid={`${testidPrefix}-add`}
        >
          <Plus className="w-3.5 h-3.5" /> Agregar persona ({value.length}/{maxPeople})
        </button>
        <span
          className={`text-sm font-semibold ${value.length > 0 && roundedSum !== 100 ? 'text-red-400' : 'text-[#3FB950]'}`}
          data-testid={`${testidPrefix}-owner-share`}
        >
          Suma: {roundedSum}% {value.length > 0 ? '(deben sumar 100)' : (requireExactSum ? '(vacío = 100% al dueño)' : '(vacío = sin comisión)')}
        </span>
      </div>
    </div>
  );
}
