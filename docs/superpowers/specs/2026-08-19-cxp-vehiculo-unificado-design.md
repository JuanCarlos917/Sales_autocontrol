# CxP unificadas en el vehículo + sync de gasto al pagar

Fecha: 2026-08-19

## Problema

Dos problemas reportados alrededor de las Cuentas por Pagar (CxP):

1. **Render incompleto en el vehículo.** Al hacer clic en una card de CxP desde
   Tesorería, la app navega a `/vehicles/:id?tab=tesoreria`, pero el tab
   Tesorería del vehículo solo pinta cards bespoke (Compra CxP, Venta CxC,
   Socio). Las CxP de **gastos** (y otras) no se renderizan ahí, así que para
   pagarlas hay que ir a "Ver todas" (`/treasury/payables`) y pagar desde esa
   ruta.

2. **El estado del gasto no se sincroniza al pagar.** Un gasto creado "con
   tesorería" en estado pendiente genera una CxP (`type='PAYABLE'`, ligada por
   `expenseId`). Al pagar esa CxP por la vía genérica (`payableService.addPayment`
   — la que usan "Ver todas" y el botón de pago del tab), la CxP queda `PAID`
   pero el gasto sigue con `paid=false`, es decir "pendiente" para siempre en la
   pestaña Gastos. `expenseService.payExpense` sí sincroniza; `addPayment` no.

## Objetivo

- Que el tab Tesorería del vehículo muestre **todas las CxP del vehículo** con la
  misma funcionalidad de pago que la ruta "Ver todas".
- Que pagar una CxP ligada a un gasto **deje el gasto en "pagado"** al completar
  el pago (más confiabilidad de datos).

## Decisiones (acordadas con el usuario)

- Lista unificada: **todas** las CxP del vehículo, `type != RECEIVABLE`, sin
  excepción (incluye `PAYABLE` de compra, `PAYABLE` de gasto, `PARTNER_SHARE`,
  `COMMISSION`, `PROFIT_SHARE`, `CAPITAL_RETURN`, `COMMISSION_RETURN`).
- Solo se unifican las **CxP (pagar)**. La CxC de venta (`RECEIVABLE`), la card
  "Socio — Comisión que debe" (`RECEIVABLE`) y la lista de movimientos quedan
  **intactas**.
- Sync del gasto: **solo forward** (pago → gasto pagado). El reverso queda
  **fuera de alcance** porque hoy no existe reverso de pagos de CxP en el sistema
  (`getReversibilityError` bloquea todo movimiento con `payablePayment`). Ver
  [[reverso-universal-progress]] — es trabajo de las fases pendientes.
- Sin migración de base de datos.

## Comportamiento

### Backend — forward sync (Parte 1)

En `backend/src/services/payableService.js`, función `addPayment`, dentro de la
transacción y **después** de actualizar la CxP (`tx.payable.update`), si
`payable.expenseId` no es nulo:

```js
if (payable.expenseId) {
  await tx.expense.update({
    where: { id: payable.expenseId },
    data: { paid: newStatus === 'PAID', updatedBy: userId },
  });
}
```

- `newStatus` ya está calculado (`newPaidAmount >= total ? 'PAID' : 'PARTIAL'`).
- Pago total → `paid = true`. Pago parcial → `paid = false` (idempotente con el
  estado que ya trae). Espeja lo que hace `expenseService.payExpense`.
- No aplica a CxC (`RECEIVABLE`) ni a CxP sin `expenseId` (no-op).

### Frontend — lista unificada en el tab Tesorería (Parte 2)

En `frontend/src/pages/VehicleDetailPage.jsx`, tab `tesoreria`:

- **Cargar** las CxP del vehículo: nueva llamada
  `payablesApi.getAll({ vehicleId: id })`, guardar en estado `vehiclePayables`,
  filtrar a `type !== 'RECEIVABLE'`.
- **Reemplazar**:
  - la card bespoke "Compra (CxP)" (bloque `paymentStatus.purchase`), y
  - la card "Socio — Ganancia" (`partnerSharePayable`, `PARTNER_SHARE`)
  por **un solo** `<PayablesList type="PAYABLE" payables={cxpDelVehiculo}
  onPayment={handlePayVehiclePayable} loading={...} />`.
- **Conservar**:
  - la card "Venta (CxC)" (`paymentStatus.sale`),
  - la card "Socio — Comisión que debe" (`partnerCommissionPayable`,
    `RECEIVABLE`),
  - la lista de movimientos.
- **`handlePayVehiclePayable(payableId, paymentData)`**: llama
  `payablesApi.addPayment(payableId, paymentData)` y luego recarga
  (`loadVehiclePayables()` + `loadPaymentStatus()` + `loadTransactions()` +
  recarga del vehículo para refrescar gastos). `PayablesList` maneja su propio
  `PaymentModal` y el estado de "procesando".
- **Permisos (`VIEWER`)**: si `isViewer`, pasar `onPayment={undefined}` a
  `PayablesList` → no se renderizan botones de pago (mantiene el readonly
  actual de `vehicle-pay-purchase` / `vehicle-pay-partner-share`).
- **Conteo del tab** (`treasuryCount`): ampliar para contar también las CxP del
  vehículo (evita que el badge del tab quede corto). Mantener el conteo de
  movimientos + CxC de venta.

Se reutiliza el componente existente `frontend/src/components/treasury/PayablesList.jsx`
(hoy exportado pero sin usar): tabla con descripción, tercero, vencimiento,
estado, total, pendiente y botón Pagar. No requiere cambios salvo que falte algo
al integrarlo (ver Riesgos).

## Arquitectura / archivos

- `backend/src/services/payableService.js` — `addPayment`: + sync `expense.paid`.
- `frontend/src/pages/VehicleDetailPage.jsx` — cargar `vehiclePayables`,
  reemplazar cards CxP por `PayablesList`, handler de pago, ampliar conteo.
- `frontend/src/components/treasury/PayablesList.jsx` — se usa tal cual (posible
  ajuste menor de props si hiciera falta).
- Sin cambios de schema/migraciones.

## Testing

- **Backend (unit/integración, TDD):**
  - `addPayment` sobre CxP con `expenseId`, pago **total** → CxP `PAID` **y**
    `expense.paid === true`.
  - `addPayment` **parcial** sobre CxP con `expenseId` → CxP `PARTIAL` y
    `expense.paid === false`.
  - `addPayment` sobre CxP **sin** `expenseId` (p.ej. compra) → no toca ningún
    gasto (no-op, sin error).
- **E2E:**
  - Actualizar `tests/e2e/vehicles/viewer-readonly-pipeline.spec.ts`: ya no
    existen `vehicle-pay-purchase`, `vehicle-partner-share-card`,
    `vehicle-pay-partner-share`; el readonly del viewer se verifica sobre la
    nueva `PayablesList` (sin botones de pago para VIEWER).
  - Nuevo flujo: crear gasto con tesorería (pendiente) → abrir el vehículo →
    tab Tesorería → aparece la CxP del gasto en la lista → pagar → la CxP queda
    pagada y, en la pestaña Gastos, el gasto pasa a "pagado".

## Riesgos / consideraciones

- **`PaymentModal` de `PayablesList`**: el pago genérico de socio/comisión enruta
  a la cuenta SOCIO en el backend (`addPayment` lo resuelve por `thirdPartyId`),
  así que el modal solo necesita cuenta + monto. Verificar al integrar que el
  modal de `PayablesList` no exija campos extra que rompan estos tipos.
- **`data-testid` removidos**: `vehicle-pay-purchase`, `vehicle-partner-share-*`
  desaparecen; cualquier e2e que los use debe migrar a los de `PayablesList`.
- **Solape con páginas dedicadas**: COMMISSION/PROFIT_SHARE ahora también se
  pueden pagar desde el vehículo (decisión explícita del usuario: "todas sin
  excepción"). El backend es la única fuente de verdad, así que pagar desde
  cualquier superficie es consistente.
- **Conteo del tab**: si se decide no tocar `treasuryCount`, el badge podría
  quedar corto; se incluye su ampliación para evitar inconsistencia visual.

## Fuera de alcance

- Reverso/storno de pagos de CxP y su sync inverso al gasto (feature aparte).
- Rediseño de la CxC (cobrar) o de la lista de movimientos.
- Cambios de backend en el endpoint `/vehicles/:id/payment-status`.
