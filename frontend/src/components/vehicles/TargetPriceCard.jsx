import { useApp } from '@/contexts/AppContext';
import { formatCurrency, formatPercent, getTargetStatus } from '@/lib/constants';

// ── Tarjeta "Precio Objetivo" (tab Financiero de VehicleDetailPage) ──
// Muestra el precio objetivo calculado (margen global o override por
// vehículo) y su semáforo de cumplimiento. Cuando no es viewer y el
// vehículo no está VENDIDO, permite editar el margen override inline.
//
// `onSaved` recarga el vehículo en el padre tras un guardado exitoso
// (mismo patrón que el resto de escritura de VehicleDetailPage: PUT →
// reload, con try/catch + alert en error).
export default function TargetPriceCard({ vehicle, metrics, isViewer, onSaved }) {
  const { updateVehicle } = useApp();
  const m = metrics || {};

  if (!(m.targetPrice > 0)) return null;

  const targetStatusInfo = getTargetStatus(m.targetStatus);
  const isSold = vehicle.stage === 'VENDIDO';
  // Margen actual mostrado como entero % (mismo redondeo que se usaba al guardar).
  const initialPct = m.isCustomMargin ? Math.round(m.effectiveMargin * 100) : null;

  const handleMarginBlur = async (e) => {
    const raw = e.target.value.trim();
    let newPct = null;

    if (raw !== '') {
      const n = parseFloat(raw);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        alert('El margen objetivo debe ser un número entre 0 y 100');
        e.target.value = initialPct ?? '';
        return;
      }
      newPct = n;
    }

    // Sin cambios reales: no dispares un PUT + reload por un blur pasajero.
    if (newPct === initialPct) return;

    const targetMargin = newPct === null ? null : newPct / 100;
    try {
      await updateVehicle(vehicle.id, { targetMargin });
      await onSaved?.();
    } catch (err) {
      console.error('Error updating target margin override:', err);
      alert(err.response?.data?.error || 'Error al guardar el margen objetivo');
    }
  };

  return (
    <div className="p-4 rounded-xl border border-accent/20 bg-accent/5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-[#8B949E]">
          Precio Objetivo
          <span className="ml-1 text-accent">{m.isCustomMargin ? '(personalizado)' : '(global)'} · {formatPercent(m.effectiveMargin)}</span>
        </div>
        {targetStatusInfo && (
          <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: targetStatusInfo.color + '18', color: targetStatusInfo.color }}>
            {targetStatusInfo.label}
          </span>
        )}
      </div>
      <div className="text-xl font-bold text-accent mt-1">{formatCurrency(m.targetPrice)}</div>
      <div className="text-[11px] text-[#8B949E] mt-0.5">
        Ganancia objetivo: {formatCurrency(m.targetProfit)}
        {m.targetGap != null && <> · Brecha: {formatCurrency(m.targetGap)}</>}
      </div>
      {!isViewer && (
        <div className="mt-2 flex items-center gap-2">
          <input
            key={vehicle.id}
            type="number"
            placeholder="Margen % override"
            defaultValue={initialPct ?? ''}
            disabled={isSold}
            title={isSold ? 'Vehículo vendido: el margen objetivo queda congelado' : undefined}
            className="w-32 bg-transparent border border-[#30363D] rounded px-2 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onBlur={handleMarginBlur}
          />
          <span className="text-[11px] text-[#8B949E]">vacío = margen global</span>
        </div>
      )}
    </div>
  );
}
