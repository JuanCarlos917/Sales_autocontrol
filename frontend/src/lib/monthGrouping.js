// ═══════════════════════════════════════════════════════════════
// monthGrouping — agrupa ítems (comisiones/ganancias) por mes de una fecha,
// con count de negocios y subtotal por mes. Función pura, sin React.
// ═══════════════════════════════════════════════════════════════

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Total del mes: suma de roles no cancelados.
export function sumRolesTotal(item) {
  return (item.roles || [])
    .filter((r) => r.status !== 'CANCELLED')
    .reduce((s, r) => s + (r.total || 0), 0);
}

// Fecha de agrupación de un ítem de comisión/ganancia.
export function saleDateOf(item) {
  return item.vehicle?.saleDate ?? null;
}

// Agrupa por mes. Grupos ordenados desc; 'sin-fecha' al final.
// Ítems de cada grupo ordenados por fecha descendente. No muta la entrada.
export function groupByMonth(items, { dateOf, sumOf }) {
  const groups = new Map();
  for (const item of items) {
    const raw = dateOf(item);
    let monthKey;
    let monthLabel;
    if (raw) {
      const d = new Date(raw);
      // formatToParts en vez de parsear el string formateado: el orden de
      // año/mes en la salida de Intl varía según la versión de ICU aunque
      // se use el mismo locale (en-CA), así que buscamos por `type` en vez
      // de asumir un orden fijo.
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota', year: 'numeric', month: '2-digit',
      }).formatToParts(d);
      const year = parts.find((p) => p.type === 'year').value;
      const month = parts.find((p) => p.type === 'month').value;
      monthKey = `${year}-${month}`;
      monthLabel = `${MONTHS_ES[parseInt(month, 10) - 1]} ${year}`;
    } else {
      monthKey = 'sin-fecha';
      monthLabel = 'Sin fecha';
    }
    if (!groups.has(monthKey)) {
      groups.set(monthKey, { monthKey, monthLabel, count: 0, subtotal: 0, items: [] });
    }
    const g = groups.get(monthKey);
    g.items = [...g.items, item];
    g.count += 1;
    g.subtotal += sumOf(item);
  }

  for (const g of groups.values()) {
    g.items = [...g.items].sort((a, b) => {
      const aDate = dateOf(a);
      const bDate = dateOf(b);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return bDate.localeCompare(aDate);
    });
  }

  return [...groups.values()].sort((a, b) => {
    if (a.monthKey === 'sin-fecha') return 1;
    if (b.monthKey === 'sin-fecha') return -1;
    if (a.monthKey === b.monthKey) return 0;
    return a.monthKey < b.monthKey ? 1 : -1;
  });
}
