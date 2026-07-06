# Reverso Universal — UI Parte 2 (créditos + arqueos + cuentas)

Fecha: 2026-07-06 · Rama: `dev` · Depende de: UI Parte 1 (préstamos, mergeada).

## Objetivo

Cablear en la UI el reverso de las tres superficies restantes de tesorería cuyo
backend ya está mergeado (Fases 3 y 4), **reutilizando** los componentes
compartidos `shared/ReverseAction.jsx` y `shared/ReversedBadge.jsx` creados en la
Parte 1. Sin nuevos endpoints, sin cambios de schema. Solo frontend + e2e.

Backend disponible (ya en `dev`):

| Superficie | Acción | Endpoint | Efecto |
|---|---|---|---|
| Pago de crédito | Reversar pago | `POST /debt-payments/:id/reverse` | storno INCOME, marca `reversedAt`; **bloquea 400 si `reconciled`** |
| Crédito | Anular en cascada | `POST /debts/:id/reverse` | reversa pagos vivos, status `CANCELLED`; bloquea 400 si hay pagos reconciliados |
| Arqueo | Anular | `POST /treasury/cash-counts/:id/reverse` | marca `voidedAt`, no mueve plata; 409 doble |
| Cuenta | Desactivar | `POST /treasury/accounts/:id/reverse` | `isActive=false`; **403 si saldo≠0 o tiene movimientos**; 409 si ya inactiva |

Todos ADMIN + motivo ≥10 (validado en backend y en `ReverseAction`).

## Cambios

### 1. `frontend/src/lib/treasuryApi.js`
Añadir métodos espejo de `loansApi`:
- `debtsApi.reversePayment(paymentId, reason)` → `POST /debt-payments/:id/reverse`
- `debtsApi.reverseDebt(id, reason)` → `POST /debts/:id/reverse`
- `cashCountsApi.reverse(id, reason)` → `POST /treasury/cash-counts/:id/reverse`
- `accountsApi.reverseAccount(id, reason)` → `POST /treasury/accounts/:id/reverse`

### 2. `frontend/src/components/treasury/PaymentDetails.jsx`
Guard por fila para pagos **reconciliados** (regla de dominio de créditos: un pago
reconciliado envuelve un egreso histórico real y NO es reversable desde aquí).
Prioridad de render en la celda de acción:
1. `p.reversedAt` → `<ReversedBadge label="Reversado">`
2. `p.reconciled` → texto muted "Conciliado" con `title` explicativo (sin botón)
3. `onReversePayment` → `<ReverseAction>`

Compatible hacia atrás: los pagos de préstamo no traen `reconciled` → sin cambios.

### 3. `frontend/src/pages/treasury/DebtDetailPage.jsx`
- Refactor: extraer `load()` reutilizable (hoy es un `useEffect` con guard `active`).
- Mapear pagos con `reversedAt` y `reconciled`.
- Pasar `onReversePayment` a `PaymentDetails` (análogo a préstamos).
- Botón "Anular crédito" (variante `red`) en el header cuando `status !== 'CANCELLED'`,
  `onConfirm={(reason) => debtsApi.reverseDebt(id, reason)}`, `onDone={load}`.
- `testid="debt-detail"` para la cascada; los pagos usan el prefijo `debt-detail`
  ya existente en `PaymentDetails` (`debt-detail-pay-<id>-*`).

### 4. `frontend/src/pages/treasury/CashCountPage.jsx`
- Nueva columna "Acciones" (colspan del empty state pasa 6→7).
- Por fila: si `cc.voidedAt` → `<ReversedBadge label="Anulado" variant="red">`;
  si no → `<ReverseAction label="Anular" variant="amber" testid={`cashcount-${cc.id}`}>`
  con `onConfirm={(r) => cashCountsApi.reverse(cc.id, r)}` y `onDone` = recargar.
- Fila anulada en estilo muted.

### 5. `frontend/src/pages/treasury/AccountsPage.jsx`
- En `renderCard`: si `account.isActive === false` → `<ReversedBadge label="Inactiva" variant="red">`
  junto al badge de tipo, y ocultar acciones.
- Cuenta activa + `!isViewer`: botón "Desactivar" (variante `amber`,
  `testid={`account-${account.id}`}`) junto a Editar/Eliminar,
  `onConfirm={(r) => accountsApi.reverseAccount(account.id, r)}`, `onDone={loadAccounts}`.
- El 403 (saldo≠0 / con movimientos) se muestra dentro del modal de `ReverseAction`.

## Tests (e2e Playwright, análogos a `loan-reverse-ui.spec.ts`)
- `debt-reverse-ui.spec.ts`: reversar un pago (badge Reversado) + anular crédito (CANCELADO).
- `cashcount-reverse-ui.spec.ts`: anular arqueo → badge Anulado, botón desaparece.
- `account-reverse-ui.spec.ts`: desactivar cuenta con saldo 0 → badge Inactiva;
  (opcional) cuenta con saldo muestra error en el modal.

## Verificación
`cd frontend && npm run build`; correr los 3 specs nuevos; suite e2e de tesorería sin regresiones.

## Fuera de alcance
- Movimientos/transferencias (Fase 6, retrofit de TransactionsPage).
- Pantalla central de Auditoría (Fase 5).
- Follow-ups backend rastreados (guarda `isActive` en escrituras, ADMIN-gate DELETE cuenta).
