# Resumen de préstamos en Tesorería — Design Spec

- **Fecha**: 2026-05-06
- **Estado**: Aprobado por usuario, pendiente plan de implementación
- **Autor**: brainstorming session
- **Spec relacionado**: `docs/superpowers/specs/2026-05-02-internal-loans-design.md`

## Contexto

La feature de préstamos internos está implementada y testeada (PR #1). Hoy, para ver "quién debe" hay que ir a `/treasury/loans` explícitamente. El usuario quiere que en el landing de Tesorería (`/treasury`) ya aparezca un resumen visual: cuánto adeudan en total y quién es. Más operativamente útil para el día a día.

## Decisiones tomadas en brainstorming

| Pregunta | Respuesta |
|---|---|
| ¿En qué dashboard? | `/treasury` (TreasuryPage). |
| ¿Qué información mostrar? | Mixto: totales arriba + dos sub-listas (vencidos / próximos a vencer). |
| Granularidad de las sub-listas | **Por persona**: una fila por deudor agregando todos sus préstamos. |
| Click en deudor | Navega a `/treasury/loans?borrower=<id>` con filtro pre-aplicado. |
| Estructura final | **Dos cards**: una con saldo total + breakdown por status, otra con top 5 deudores. |

## UI

### Card 1 — Saldo total

Contenido:
- Título: "💸 Préstamos activos".
- Número grande con el total adeudado: `sum(loan.principalAmount - loan.paidAmount)` sobre préstamos con `status NOT IN (PAID, CANCELLED)`.
- Breakdown por status del deudor (NO del préstamo individual):
  - **🔴 Vencido**: monto pendiente de deudores con al menos una cuota `dueDate < now AND status != PAID` (suma del saldo total de esos deudores).
  - **🟡 Próximo**: monto pendiente de deudores **no vencidos** con al menos una cuota `dueDate <= now + 7d AND status != PAID`.
  - **🟢 Al día**: el resto.
- Footer: `N préstamos • M deudores`.

### Card 2 — Top 5 deudores

Lista agrupada por `borrowerId`. Cada fila:
- Badge de status (🔴 / 🟡 / 🟢, mismas reglas que card 1).
- Nombre del deudor.
- Monto pendiente del deudor (suma sobre todos sus préstamos activos).
- Click → navega a `/treasury/loans?borrower=<id>`.

Orden:
1. 🔴 primero, 🟡, 🟢 al final.
2. Dentro de cada grupo, por monto pendiente DESC.

Limitar a top 5. Footer: link "Ver todos →" a `/treasury/loans`.

### Posición en TreasuryPage

Nueva sección "Préstamos" debajo de los stats superiores (saldos por cuenta, CxP/CxC) y antes de la grid "Movimientos / Cuentas / Terceros / Arqueo / Préstamos".

## Datos / Backend

**Sin endpoint nuevo.** Reusa `GET /api/loans` (ya devuelve `installments` con `dueDate` + `paidAmount` + `status` + flag `isOverdue`).

Cómputo en frontend dentro de un componente `LoansSummaryCards.jsx`:

```js
const NOW = new Date();
const SOON = new Date(); SOON.setDate(SOON.getDate() + 7);

function classifyLoan(loan) {
  if (loan.status === 'PAID' || loan.status === 'CANCELLED') return 'CLOSED';
  const overdue = loan.installments.some(i => i.status !== 'PAID' && new Date(i.dueDate) < NOW);
  if (overdue) return 'OVERDUE';
  const upcoming = loan.installments.some(i => i.status !== 'PAID' && new Date(i.dueDate) <= SOON);
  if (upcoming) return 'UPCOMING';
  return 'ON_TRACK';
}

function classifyBorrower(loansOfBorrower) {
  const classes = loansOfBorrower.map(classifyLoan);
  if (classes.includes('OVERDUE')) return 'OVERDUE';
  if (classes.includes('UPCOMING')) return 'UPCOMING';
  return 'ON_TRACK';
}
```

Justificación: el dataset esperable es chico (< 100 préstamos activos), computar en cliente es O(n) y evita mantener un endpoint dedicado en sync con la lógica de status.

### Pseudocódigo de agregación por deudor

```js
const active = loans.filter(l => l.status !== 'PAID' && l.status !== 'CANCELLED');

const byBorrower = new Map(); // borrowerId → { borrower, loans, totalPending, status }
for (const loan of active) {
  const entry = byBorrower.get(loan.borrowerId) || {
    borrower: loan.borrower,
    loans: [],
    totalPending: 0,
  };
  entry.loans.push(loan);
  entry.totalPending += parseFloat(loan.principalAmount) - parseFloat(loan.paidAmount);
  byBorrower.set(loan.borrowerId, entry);
}

for (const entry of byBorrower.values()) {
  entry.status = classifyBorrower(entry.loans);
}
```

### Empty state

Si `active.length === 0`:
- Card 1 muestra "Total adeudado $0" + texto "Sin préstamos activos".
- Card 2 muestra placeholder "✓ Nadie debe dinero" — sin filas, sin link "Ver todos".

## Filtro por deudor en LoansPage

`LoansPage` lee `borrower` desde `useSearchParams`. Si está presente:
- Filtra `loans.filter(l => l.borrowerId === borrowerId)` antes de aplicar la tab activa.
- Renderiza un badge encima de la lista: "Filtrando por: [nombre] ✕". Click en ✕ limpia el query param via `setSearchParams({})` (no recarga la página).
- El filtro es URL-driven: refrescar la página o copiar el link mantiene el filtro.

## Tests E2E

Dos specs nuevos en `tests/e2e/treasury/loans-summary.spec.ts`:

1. **Card de totales refleja saldos**: crear 2 préstamos vía API con principal=$2M y $3M, pago parcial de $500K en uno → ir a `/treasury` → verificar que el total adeudado mostrado = $4.5M.
2. **Click en deudor filtra LoansPage**: crear 2 préstamos con deudores distintos vía API → ir a `/treasury` → click en el card del deudor A → URL pasa a `/treasury/loans?borrower=<idA>` → solo el préstamo de A aparece en la página.

Skip explícito en este sprint: testar status `🔴 Vencido` requiere manipular `dueDate` retroactivamente desde la API o crear un endpoint de testing — agrega fricción para poco valor incremental. Se puede agregar después si la lógica de status muestra bugs en producción.

## Plan de sprints

| Sprint | Alcance | Tamaño |
|---|---|---|
| **D.1** | `LoansSummaryCards.jsx` + integración en `TreasuryPage`. Lógica `classifyLoan` / `classifyBorrower`. Renderizado de las dos cards. | ~45 min |
| **D.2** | Filtro `?borrower=<id>` en `LoansPage` con badge desmontable. | ~15 min |
| **D.3** | 2 tests E2E. | ~30 min |

Total: **~1.5 h** funcional + testeado.

## Cambios a archivos

| Archivo | Cambio |
|---|---|
| `frontend/src/components/treasury/LoansSummaryCards.jsx` | NUEVO |
| `frontend/src/components/treasury/index.js` | + export |
| `frontend/src/pages/treasury/TreasuryPage.jsx` | Insertar sección "Préstamos" con `<LoansSummaryCards />` |
| `frontend/src/pages/treasury/LoansPage.jsx` | Leer `useSearchParams`, filtrar por borrower, renderizar badge desmontable |
| `tests/e2e/treasury/loans-summary.spec.ts` | NUEVO |
| `tests/helpers/api.ts` | Sin cambios (helpers existentes alcanzan) |

## Out of scope (YAGNI)

- Test E2E para status vencido / próximo (requiere manipular fechas).
- Widget en `/dashboard` (DashboardPage) — el usuario eligió `/treasury` solamente.
- Modal de detalle por deudor — descartado a favor de filtro URL-driven en LoansPage existente.
- Drag & drop, ordenar por columna, paginación de la lista — out of scope; top 5 fija.
- Snooze / marcar como contactado — fuera de alcance.
- Notificaciones automáticas de cuotas próximas a vencer — feature aparte si se necesita.
