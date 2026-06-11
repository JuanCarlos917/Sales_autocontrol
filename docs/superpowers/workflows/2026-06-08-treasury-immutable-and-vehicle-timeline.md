# Workflow — Movimientos inmutables + Historial unificado del vehículo

**Spec base:** [2026-06-07-treasury-traceability-audit.md](../audits/2026-06-07-treasury-traceability-audit.md)
**Predecesor:** [2026-06-07-treasury-traceability-phase-1.md](./2026-06-07-treasury-traceability-phase-1.md)
**Fecha:** 2026-06-08

## Decisiones del usuario

1. **Movimientos y transferencias son inmutables**. Se elimina la UI y el endpoint `DELETE` de `Transaction` y `Transfer`. Cualquier corrección se hace creando un nuevo movimiento de ajuste o registrando un nuevo gasto.
2. **Ajustes y reversos visibles**. El rollup actual de `/treasury/transactions` se quita. Cada `EXPENSE_ADJUSTMENT` y `EXPENSE_REVERSAL` aparece como fila separada con badge claro y referencia al movimiento original (`reversesTransactionId`).
3. **Historial del vehículo unificado**. La pestaña Historial de `VehicleDetailPage` deja de mostrar solo `VehicleAuditLog` y pasa a un timeline ordenado por fecha con:
   - Cambios de identidad del vehículo (lo de hoy).
   - `ExpenseAuditLog` (crear/editar/eliminar/restaurar gasto del vehículo).
   - `Transaction` del vehículo (compra, gasto, ajuste, reverso, venta).
4. **Forma del ajuste**: una sola fila con el delta (forma actual). Sin cambios.

## Out of scope

- Loans / LoanPayment audit (Fase 2 de la auditoría).
- Soft delete de Transaction (queda obsoleto: ahora la regla es "no se borra nunca").
- UI para cancelar CxP con motivo (queda como mejora opcional, ya hay endpoint).
- Pagos de CxP/CxC en el timeline (no fue parte de la respuesta del usuario).

## Pasos (TDD por paso; commit por paso)

| # | Tarea | Files | Test primero | Esfuerzo |
|---|---|---|---|---|
| 1 | Borrar UI 🗑 en TransactionsPage que agregamos | `frontend/src/pages/treasury/TransactionsPage.jsx`, helpers `treasuryApi.js` | e2e: el botón no existe | S |
| 2 | Quitar rutas DELETE de Transaction y Transfer + sus services | `backend/src/routes/treasury.js`, `backend/src/services/transactionService.js`, `backend/src/services/transferService.js`, `backend/src/controllers/transactionController.js`, `backend/src/controllers/transferController.js` | e2e: DELETE retorna 404/405 | M |
| 3 | Quitar test `tests/e2e/treasury/destructive-audit.spec.ts` (queda obsoleto) + ajustar `treasury-bypass-blocked.spec.ts` para validar que DELETE no existe | tests/e2e | n/a | S |
| 4 | Backend: quitar rollup en `transactionService.getAll`. Cada Transaction (incluyendo ADJUSTMENT/REVERSAL) se devuelve como fila. Incluir `reversesTransactionId` y join opcional al original. | `transactionService.js` | e2e: editar un gasto pagado → /treasury/transactions devuelve 2 filas (original + ADJUSTMENT) | M |
| 5 | Invertir tests `expense-edit-rollup.spec.ts`: ahora el comportamiento esperado es ver original+ajuste, no 1 sola fila | `tests/e2e/treasury/expense-edit-rollup.spec.ts` | reescribir | S |
| 6 | Frontend TransactionsPage: render de badge Ajuste / Reverso, y mostrar referencia "(de mov. #abc…)" cuando `reversesTransactionId` está set | `frontend/src/pages/treasury/TransactionsPage.jsx`, posiblemente helpers `lib/constants.js` | manual + e2e mínimo | S |
| 7 | Backend: endpoint `GET /vehicles/:id/timeline` que devuelve eventos unificados (VehicleAuditLog + ExpenseAuditLog + Transaction del vehículo) en orden cronológico desc, paginado | `backend/src/services/vehicleTimelineService.js` (nuevo), `backend/src/controllers/vehicleController.js`, `backend/src/routes/vehicles.js` | e2e: crear gasto + editar + ver timeline tiene 2 entradas (CREATE expense + UPDATE expense) | M |
| 8 | Frontend: refactor de la pestaña Historial en `VehicleDetailPage` para consumir `/timeline` en vez de `/audit` y renderizar entradas heterogéneas con icon + título + descripción + fecha + autor | `frontend/src/pages/VehicleDetailPage.jsx`, posible nuevo componente `VehicleTimeline.jsx` | manual + e2e mínimo | M |
| 9 | E2E completo del flujo: crear vehículo → crear gasto pagado de 500k → editar a 700k con motivo → abrir vehículo → pestaña Historial muestra crear+editar; /treasury/transactions muestra VEHICLE_EXPENSE 500k + EXPENSE_ADJUSTMENT +200k | `tests/e2e/vehicles/vehicle-timeline.spec.ts` (nuevo) | sí (TDD) | M |
| 10 | Regresión completa + PR | full suite | n/a | n/a |

## Detalles técnicos por paso

### Paso 2 — eliminar rutas DELETE

- Quitar handlers `router.delete('/transactions/:id', …)` y `router.delete('/transfers/:id', …)`.
- Quitar `transactionService.delete` y `transferService.delete`.
- Quitar `remove` de los controllers correspondientes.
- Mantener `treasuryDestructiveSchema` solo porque `POST /payables/:id/cancel` lo sigue usando.
- Mantener tabla `TreasuryAuditLog`: ya queda útil para `PAYABLE.CANCEL` y para futuros eventos. No hace falta migración nueva.

### Paso 4 — quitar rollup

Hoy `transactionService.getAll` aplica un filtro que reemplaza pares (VEHICLE_EXPENSE + EXPENSE_ADJUSTMENT) por el monto neto y oculta REVERSAL. Se elimina ese filtro. La query queda simple: traer todas las Transaction con joins (account, vehicle, thirdParty, reverses). El balance de cuentas no cambia porque ya estaba calculado sobre todas las transacciones.

### Paso 6 — UI de ajustes

Categorías a estilizar:
- `VEHICLE_EXPENSE` → estilo actual.
- `EXPENSE_ADJUSTMENT` → badge naranja "Ajuste" + tooltip con el id del original.
- `EXPENSE_REVERSAL` → badge gris "Reverso" + link al original.
- `OTHER_INCOME`, `OTHER_EXPENSE`, `VEHICLE_PURCHASE`, `VEHICLE_SALE`, `COMMISSION`, `TRANSFER_*` → como hoy.

### Paso 7 — endpoint `/vehicles/:id/timeline`

Forma de la respuesta:

```json
{
  "events": [
    {
      "type": "VEHICLE_AUDIT" | "EXPENSE_AUDIT" | "TRANSACTION",
      "id": "evento-id",
      "createdAt": "2026-06-08T12:00:00Z",
      "actor": { "id": "u-1", "name": "Juan", "email": "..." } | null,
      "action": "CREATE" | "UPDATE" | "DELETE" | "RESTORE" | null,
      "category": "VEHICLE_EXPENSE" | null,
      "amount": "200000" | null,
      "description": "Ajuste de monto",
      "metadata": { "before": {...}, "after": {...}, "reason": "...", "reversesTransactionId": "..." }
    }
  ]
}
```

Ordenado por `createdAt` desc. Sin paginación por ahora (vehículos rara vez tienen >100 eventos).

### Paso 8 — UI del timeline

Componente `<VehicleTimeline events={…} />`:
- Cada evento es una fila con: icono (📝 audit, 💰 expense, 🔁 transaction), título corto, monto si aplica, motivo si aplica, fecha + autor.
- Color de borde por tipo.
- Click en una entrada de Transaction abre tooltip con el `reversesTransactionId` si existe.

## Verificación final

- [ ] DELETE `/treasury/transactions/:id` → 404 o método no permitido.
- [ ] DELETE `/treasury/transfers/:id` → 404 o método no permitido.
- [ ] `/treasury/transactions` después de editar un gasto pagado muestra 2 filas (original + ajuste) en vez de 1.
- [ ] `VehicleDetailPage` pestaña Historial muestra cambios de identidad + gastos + movimientos en orden cronológico.
- [ ] Suite e2e completa en verde.
- [ ] No quedan tests verdes que dependan del rollup viejo.
