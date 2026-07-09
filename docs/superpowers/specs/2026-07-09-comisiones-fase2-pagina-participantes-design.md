# Comisiones Fase 2 — Página dedicada + participantes en la venta — Diseño

Fecha: 2026-07-09 · Estado: aprobado por el usuario · Rama objetivo: `dev`

## Problema

El motor de comisiones (Fase 1, en producción) calcula y persiste todo al vender
— base sobre la ganancia, bolsillos (comisión/reinversión/impuestos), CxPs por
rol (CAPTADOR/CERRADOR), transfers automáticos a cuentas BUDGET — pero:

1. Las comisiones viven "escondidas" como una pestaña dentro de CxC/CxP
   (PayablesPage); no hay una vista contable clara por carro vendido.
2. La UI de venta NO permite asignar quién captó/cerró: todo va al dueño
   (`owner-self`) por defecto (el propio código lo marca como "Fase 2").

Meta del usuario: una sección intuitiva y de alto nivel para llevar la
contabilidad de comisiones — por cada carro vendido ver de dónde sale la
comisión (cascada completa) y pagarla con trazabilidad (movimiento en
tesorería ligado a la placa).

## Decisiones del usuario (cerradas)

1. **Participantes**: casi siempre el dueño; el default actual queda intacto y
   la venta gana una sección opcional para reasignar ocasionalmente.
2. **Ubicación**: página propia `/treasury/commissions` con entrada en el menú
   de tesorería. La pestaña actual de PayablesPage NO se toca en esta fase.
3. **Pago**: por rol (1 CxP por rol, como está modelado). Sin botón "pagar todo".
4. **Card**: cascada completa (venta − costo − gastos = ganancia → base × % =
   bolsillo → reparto por rol → pagado/pendiente).
5. **Alcance de la vista**: pendientes arriba (accionables) + historial de
   pagadas colapsado debajo. Nada desaparece.

## Enfoque (aprobado: A)

Agregación sobre lo **ya persistido** — cero migraciones, cero matemática nueva:
- Montos por rol: `SaleParticipant` (role, sharePct, amount) + `Payable`
  COMMISSION (totalAmount, paidAmount, status).
- Ganancia/base: recalculadas con `calculateCommissionBase(vehicle)` de
  `financial.js` (el mismo helper que usó la venta — determinístico).
- El pago reutiliza `POST /payables/:id/payments` + `PaymentModal` existentes.
- Si los % de settings cambian después de una venta, la card muestra los montos
  persistidos de ESA venta; el % mostrado se deriva de los montos reales.

Descartados: B (tabla snapshot nueva — migración+backfill para datos derivables,
YAGNI) y C (cálculo en frontend — viola la centralización en `financial.js`).

## Backend

**`GET /api/commissions`** (ruta nueva `routes/commissions.js` + controller thin
+ `commissionService.listByVehicle()`; la matemática permanece en `financial.js`).

Respuesta: lista de vehículos VENDIDO **que tengan CxPs COMMISSION**, cada item:

```js
{
  vehicle: { id, plate, brand, model, saleDate, salePrice },
  cascade: {
    salePrice, purchaseCost, directExpenses,   // de calculateCommissionBase
    grossProfit, participation, commissionBase,
    commissionPool                             // Σ totalAmount CxPs COMMISSION (persistido)
  },
  roles: [{
    role, thirdParty: { id, name }, sharePct,
    total, paid, pending, status, payableId,
    payments: [{ date, amount, accountName }]
  }],
  buckets: { reinvest, tax }  // transfers de bolsillos de esa venta (informativo; ver nota)
}
```

- Orden: pendientes/parciales primero (saleDate desc), luego pagadas.
- Query param `?status=pending|paid|all` (default `all`; la UI separa secciones).
- Nota buckets: los transfers de bolsillos se localizan por
  `vehicleId + category TRANSFER + toAccountId ∈ {reinvest, tax}` de la config;
  si no se encuentran (ventas raras/antiguas), `buckets` va en null y la UI
  omite esa línea — informativo, nunca bloqueante.
- Roles con CxP CANCELLED se incluyen con su status (la UI los tacha); no suman
  a pendientes.

## Frontend

**Página `frontend/src/pages/treasury/CommissionsPage.jsx`** (ruta
`/treasury/commissions`, entrada "Comisiones" en el menú de tesorería):

- KPIs: total pendiente, pagado del mes, desglose captador/cerrador pendiente.
- Card por carro (cascada completa):

```
┌─ FJT326 · Vitara · vendida 01-jun ────────────────────┐
│ Venta            $57.500.000                          │
│ − Costo          $50.000.000                          │
│ − Gastos          $2.454.000                          │
│ = Ganancia        $5.046.000                          │
│ Base comisión (×100% part.)          $5.046.000       │
│ Bolsillo comisión (60%)              $3.027.600       │
│ · Reinversión $1.513.800 · Impuestos $504.600  ✓ auto │
│ ──────────────────────────────────────────────        │
│ CAPTADOR  Juan (30%)   $908.280   PENDIENTE  [Pagar]  │
│ CERRADOR  Juan (70%)  $2.119.320  PAGADO ✓ 05-jun     │
└───────────────────────────────────────────────────────┘
```

- **[Pagar]** por rol → `PaymentModal` existente (monto pre-llenado con el
  pendiente) → `POST /payables/:id/payments`. El movimiento resultante ya
  queda "Pago realizado: Comisión venta <placa> — <rol>", categoría COMISIÓN,
  vinculado al vehículo (badge de placa en Movimientos). Cero lógica de pago
  nueva. Al cerrar con éxito: `onDone={load}`.
- Pago PARCIAL: barra pagado/pendiente; [Pagar] pre-llena el restante.
- Sección "Pagadas" colapsada bajo las pendientes.

**Selector de participantes en `SalePaymentModal`** (paso 2, colapsado):

- `▸ Comisión — Captador/Cerrador (default: tú)`.
- Expandido: 2 filas (CAPTADOR, CERRADOR), cada una `ThirdPartySelector`
  (default owner-self) + input % (defaults de settings).
- Validación en vivo: suma = 100 (mismo contrato del backend).
- Sin tocar → no se envía `participants` → default actual intacto.
- Tocado → `participants: [{thirdPartyId, role, sharePct}×2]` — el backend ya
  lo soporta (`resolveParticipants`), cero cambios en `saleService`.

## Casos borde

| Caso | Comportamiento |
|---|---|
| Venta con base ≤ 0 (pérdida) o skip | Sin CxPs → no aparece en la página (hoy ya no se genera comisión). |
| Venta pre-Fase 1 (sin CxP COMMISSION) | No aparece. |
| % de settings cambiados post-venta | Card muestra montos persistidos de esa venta; % derivado de montos. |
| Pago parcial | Estado PARCIAL, [Pagar] pre-llena restante. |
| CxP cancelada | Tachada con motivo; no suma a pendientes. |
| Cuenta sin saldo al pagar | PaymentModal advierte; el guard duro de backend es el hallazgo 🟠 #2 de la auditoría pausada — esta feature no lo arregla ni lo empeora. |
| Participantes que no suman 100 | Bloqueado en UI y backend (400, ya existe). |
| Transfers de bolsillos no localizables | `buckets: null`, la UI omite la línea. |

## Testing

- **Unit (node --test)**: `commissionService.listByVehicle` — cascada correcta;
  % derivado de montos; exclusión de ventas sin CxP; orden pendientes→pagadas;
  buckets null cuando no hay transfers.
- **E2E (Playwright)**:
  1. Vender carro → aparece en `/treasury/commissions` con cascada y 2 roles
     pendientes → pagar CAPTADOR → PAGADO + movimiento con placa en Movimientos.
  2. Vender con participantes custom (tercero real, 40/60) → CxPs a nombre del
     tercero con esos %.
- Suite backend completa + build frontend antes de merge (regla del proyecto).

## Fuera de alcance

- Tocar la pestaña Comisiones de PayablesPage.
- Reverso de pagos de comisión (el reverso universal existe para una fase futura).
- Reportes de comisiones por período.
- Guard de saldo en `payableService.addPayment` (pertenece a la auditoría de
  tesorería pausada, hallazgo 🟠 #2).
