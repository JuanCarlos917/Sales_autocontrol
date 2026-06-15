# Spec: Sección "Detalles" de pagos en cards de préstamos y créditos

- **Fecha:** 2026-06-15
- **Estado:** Aprobado (diseño)
- **Módulo:** Frontend — Tesorería → Préstamos (`/treasury/loans`) y Créditos (`/treasury/debts`)

## Problema / objetivo

En cada card de préstamo (y de crédito) no se ve el historial de pagos. Se quiere una
sección **"Detalles"** dentro de la card que muestre los pagos realizados con **fecha,
valor, cuenta y observación**. Es solo visualización; **no se modifica nada en
`/treasury/transactions`** ni en el backend.

## Contexto del código

Los pagos ya vienen en el objeto que consume cada página (ordenados por fecha desc):
- **Préstamos** (`loan.payments`, vía `LOAN_INCLUDE`): `{ id, date, principalAmount, extraAmount, capitalPortion, interestPortion, notes, account: { id, name } }`.
- **Créditos** (`debt.payments`, vía `DEBT_INCLUDE`): `{ id, date, amount, notes, account: { id, name } }`.

Por lo tanto el cambio es 100% frontend; no hay endpoints ni schema nuevos.

## Decisiones de diseño (confirmadas)

| Tema | Resolución |
|---|---|
| Valor por pago | **Total recibido** del pago (un solo monto) |
| Comportamiento | Sección **colapsable** (toggle "Detalles"), cerrada por defecto |
| Cuenta | **Sí** se muestra la cuenta del movimiento |
| Alcance | Préstamos **y** créditos |

## Diseño

### Componente compartido `PaymentDetails`

Nuevo `frontend/src/components/treasury/PaymentDetails.jsx`:
- **Props:**
  - `payments`: lista normalizada `[{ id, date, amount, accountName, notes }]` (ya ordenada por fecha desc por el backend).
  - `testidPrefix`: string para los `data-testid` (ej. `loan-card-<id>` o `debt-card-<id>`).
- **Render:**
  - Un encabezado/botón colapsable **"Detalles (N)"** donde N = cantidad de pagos. Cerrado por defecto; alterna abierto/cerrado. `data-testid={`${testidPrefix}-details-toggle`}`.
  - Al expandir (`data-testid={`${testidPrefix}-details`}`), una lista; cada fila (`data-testid={`${testidPrefix}-details-row-${p.id}`}`) muestra: **fecha** (`formatDate`), **valor** (`formatCurrency`), **cuenta** (`accountName` o "—"), **observación** (`notes` o "—").
  - Estado vacío (sin pagos): texto "Sin pagos registrados" y el toggle puede mostrarse deshabilitado o con "(0)".
- Solo lectura; visible para todos los roles (incluido VIEWER) — es información, no un control de escritura.
- Reutiliza `formatCurrency` y `formatDate` de `@/lib/constants`.

### Integración

- **`LoansPage`** (`frontend/src/pages/treasury/LoansPage.jsx`): dentro de cada card, debajo del bloque de botones de acción, renderizar `<PaymentDetails>` con:
  - `testidPrefix={`loan-card-${loan.id}`}`
  - `payments` mapeado de `loan.payments`: `amount = parseFloat(principalAmount) + parseFloat(extraAmount)`, `accountName = p.account?.name`, `date`, `notes`, `id`.
- **`DebtsPage`** (`frontend/src/pages/treasury/DebtsPage.jsx`): igual, dentro de cada card:
  - `testidPrefix={`debt-card-${debt.id}`}`
  - `payments` mapeado de `debt.payments`: `amount = parseFloat(p.amount)`, `accountName = p.account?.name`, `date`, `notes`, `id`.

## Tests (E2E Playwright, sin migración)

- **Préstamo:** crear un préstamo y registrar un pago (con observación) vía API; en `/treasury/loans` abrir el toggle "Detalles" de esa card y verificar que aparece la fila con el valor formateado, la cuenta y la observación.
- **Crédito:** mismo flujo en `/treasury/debts` con un `DebtPayment`.
- Verificar que la sección es visible también para VIEWER (solo lectura) — opcional/ligero.

## Fuera de alcance (YAGNI)

- Cualquier cambio en `/treasury/transactions` o en el backend.
- Editar/eliminar/anular pagos desde la card (solo lectura).
- Paginación del historial (los pagos por préstamo son pocos; se listan todos).
- Desglose capital/interés por pago (se eligió mostrar el total recibido).
