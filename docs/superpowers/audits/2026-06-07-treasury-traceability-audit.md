# Auditoría de Trazabilidad de Tesorería — AutoControl

**Fecha:** 2026-06-07
**Alcance:** Backend services + controllers + schema + frontend treasury pages
**Modo:** Read-only. No se modificó código.
**Objetivo:** Verificar que toda mutación financiera (ingreso, egreso, edición, reverso, transferencia, cobro, pago) sea identificable, vinculable a su origen, y surfaceable en UI sin pérdida de información.

---

## 1. Inventario de operaciones de tesorería

| Operación | Entidad afectada | Servicio | Endpoint | Crea Transaction? | Audit log dedicado? | Reversible? |
|---|---|---|---|---|---|---|
| Crear cuenta | Account | `accountService.create` | `POST /treasury/accounts` | Sí (saldo inicial) | ❌ | N/A |
| Editar cuenta | Account | `accountService.update` | `PUT /treasury/accounts/:id` | No | ❌ | N/A |
| Borrar cuenta | Account | `accountService.delete` | `DELETE /treasury/accounts/:id` | No | ❌ | No |
| Crear ingreso manual | Transaction | `transactionService.createIncome` | `POST /treasury/transactions/income` | Sí | ❌ | Borrando |
| Crear egreso manual | Transaction | `transactionService.createExpense` | `POST /treasury/transactions/expense` | Sí | ❌ | Borrando |
| Editar transaction manual | Transaction | `transactionService.update` | `PUT /treasury/transactions/:id` | No (mut in place) | ❌ | No |
| Borrar transaction manual | Transaction | `transactionService.delete` | `DELETE /treasury/transactions/:id` | No (hard delete) | ❌ | No |
| Crear transferencia | Transfer + 2× Transaction | `transferService.create` | `POST /treasury/transfers` | Sí (TRANSFER_IN + TRANSFER_OUT) | ❌ | Borrando |
| Borrar transferencia | Transfer (+ cascade Tx) | `transferService.delete` | `DELETE /treasury/transfers/:id` | No (hard delete las 2 Tx) | ❌ | No |
| Crear gasto pagado | Expense + Transaction | `expenseService.createWithTreasury` | `POST /expenses` | Sí | ✅ ExpenseAuditLog | Soft delete + reverso |
| Crear gasto a crédito | Expense + Payable | `expenseService.createWithTreasury` | `POST /expenses` | No | ✅ | Soft delete + cancela Payable |
| Editar gasto pagado | Expense + Tx ADJUSTMENT | `expenseService.update` | `PUT /expenses/:id` | Sí (ADJUSTMENT compensatoria) | ✅ con `reason` opcional | Borrando + restore |
| Soft-delete gasto | Expense + Tx REVERSAL | `expenseService.delete` | `DELETE /expenses/:id` | Sí (REVERSAL) | ✅ con `reason` obligatorio (≥10 chars) | Restore en ventana 5 min |
| Restaurar gasto | Expense + delete reversals | `expenseService.restore` | `POST /expenses/:id/restore` | Borra REVERSAL | ✅ | N/A |
| Crear venta | Vehicle + Tx + Payable + Transfer + SaleParticipant | `saleService.registerSale` | `POST /vehicles/:id/sell` | Sí (varias) | ✅ VehicleAuditLog parcial | `cancelSale` (limitado) |
| Cancelar venta | Reverte Vehicle | `saleService.cancelSale` | `POST /vehicles/:id/cancel-sale` | No (rechaza si hay Tx) | ❌ sin reason ni audit | N/A |
| Crear compra | Vehicle + Tx + Payable | `purchaseService.confirmPurchase` | `POST /vehicles/:id/confirm-purchase` | Sí | ✅ VehicleAuditLog | No directamente |
| Cobrar venta (CxC) | Tx + PayablePayment | `payableService.addPayment` | `POST /payables/:id/payments` | Sí | ❌ | No directamente |
| Pagar compra/comisión (CxP) | Tx + PayablePayment | `payableService.addPayment` | `POST /payables/:id/payments` | Sí | ❌ | No directamente |
| Cancelar Payable | Payable.status=CANCELLED | `payableService.cancel` | `POST /payables/:id/cancel` | No | ❌ sin reason | No |
| Desembolso de préstamo | Loan + Tx | `loanService.create` | `POST /loans` | Sí | ❌ | No |
| Pago de cuota préstamo | LoanPayment + Tx | `loanService.addPayment` | `POST /loans/:id/payments` | Sí | ❌ | No |
| Arqueo de caja | CashCount | `cashCountService.create` | `POST /treasury/cash-counts` | No | ❌ | No |

---

## 2. Mapa de trazabilidad por operación

### ✅ Bien trazadas (cumplen mejores prácticas)

#### Expense (gasto vehicular) — todos los flujos
- **Identificador único:** `expense.id` (cuid) — usado consistentemente en FK
- **Vínculo bidireccional:** `expense.id` ↔ `transaction.expenseId` ↔ `payable.expenseId`
- **Audit log:** `ExpenseAuditLog` con before/after (JSON), `userId`, `action`, `reason`, timestamp. Acciones cubiertas: CREATE, UPDATE, DELETE, RESTORE.
- **Surface en UI:** `ExpenseAuditModal` accesible desde `/expenses` → menú "Ver auditoría" en cada card.
- **Reversibilidad:** soft delete con `deletedAt`. Transactions originales quedan + se crea EXPENSE_REVERSAL compensatoria. Restore en ventana de 5 min elimina los reversals.
- **`reason` obligatorio** en delete (`min(10).max(500)`).

#### Vehicle (ediciones de identidad, cambios de etapa)
- **Identificador único:** `vehicle.id`
- **Audit log:** `VehicleAuditLog` con before/after, action (UPDATE / STAGE_CHANGE), userId.
- **Surface en UI:** pestaña "Historial" en `VehicleDetailPage`.
- **Limitación:** sin campo `reason` obligatorio.

---

### ⚠️ Parcialmente trazadas (gaps menores o sin UI)

#### Sale (venta) y SaleParticipant
- **Identificador único:** sí (cuid)
- **Vínculo:** `payable.vehicleId` + `saleParticipant.payableId`
- **Audit log:** parcial — la **creación de la venta** se audita vía `VehicleAuditLog` (stage_change a VENDIDO), pero los detalles financieros (cuántos participantes, qué split, qué transfers) NO quedan en audit log explícito. Para reconstruir el historial hay que cruzar varias tablas.
- **Surface:** los participantes se ven en `/treasury/payables` tab Comisiones; los transfers en `/treasury/transactions`. No hay vista unificada de "auditoría de venta".

#### Loan + LoanPayment
- **Identificador único:** sí
- **Vínculo:** `loanPayment.loanId`, `transaction.loanId`, `transaction.loanPaymentId`
- **Audit log:** **ninguno**. Si se modifica el monto de una cuota o se elimina, no hay rastro.
- **Surface:** sí hay listado de pagos por préstamo.

---

### ❌ Sin trazabilidad (gaps críticos)

#### Account (cuenta de tesorería)
- **`update`** muta `accountService.update` directamente sin audit log, sin restricciones de campos, sin reason. Se puede cambiar el `initialBalance` y nadie se entera. **Severidad: CRÍTICA.**
- **`delete`** hard-deleta sin audit log. Solo restringe si hay transactions asociadas, pero si la cuenta está vacía se borra sin registro. **Severidad: ALTA.**

#### Transaction manual (no ligada a Expense ni a Transfer ni a Sale)
- **`update`** (`transactionService.update`): edita description / reference / date / thirdPartyId in place SIN audit log. **Severidad: ALTA.**
- **`delete`**: hard-delete SIN reason, SIN audit log. La transaction desaparece de la DB. **Severidad: CRÍTICA.** Solo guard: rechaza si está ligada a vehículo VENDIDO.
- Ruta `DELETE /treasury/transactions/:id` **no tiene validate schema** (no pide ni `reason` ni body alguno).

#### Transfer (transferencia entre cuentas)
- **`delete`** (`transferService.delete`): hard-deleta el Transfer + las 2 Transactions TRANSFER_IN/TRANSFER_OUT en cascada. SIN reason. SIN audit log. **Severidad: CRÍTICA.** Una transferencia se puede borrar sin dejar absolutamente ningún rastro.
- Ruta `DELETE /treasury/transfers/:id` sin validate schema.

#### Payable (CxC / CxP)
- **`addPayment`** (cobro o pago parcial): crea Transaction + PayablePayment SIN audit log dedicado para el evento de pago. No queda registro de "por qué se hizo este pago", solo el monto y la cuenta.
- **`cancel`** (cancelar CxC/CxP): cambia status a `CANCELLED` SIN reason, SIN audit log. **Severidad: ALTA.**

#### PayablePayment
- Tabla no tiene audit log propio. Si se eliminara un pago parcial (no hay endpoint actual, pero podría agregarse), no quedaría rastro.

#### Saldo inicial de cuenta
- Si `accountService.update` se usa para cambiar `initialBalance`, NO se crea transaction compensatoria ni audit. El saldo cambia mágicamente.

---

## 3. Gaps de trazabilidad (clasificados)

### 🔴 CRÍTICOS

| # | Gap | Evidencia | Impacto |
|---|---|---|---|
| C1 | `DELETE /treasury/transactions/:id` no pide `reason` ni audit log | `routes/treasury.js:58`, `transactionService.js:194-220` | Transactions manuales (ingresos / egresos / aportes de capital) se borran sin rastro. Auditor no puede reconstruir. |
| C2 | `DELETE /treasury/transfers/:id` hard-deleta sin reason ni audit | `routes/treasury.js:66`, `transferService.js:118-135` | Una transferencia entre cuentas se evapora; saldos parecen inconsistentes con extracto bancario sin explicación. |
| C3 | `accountService.update` permite modificar `initialBalance` sin audit | `accountService.js:62-67` | Saldo de una cuenta se puede alterar y nadie lo nota; rompe conciliación. |
| C4 | Reversos (`EXPENSE_REVERSAL` / `EXPENSE_ADJUSTMENT`) no apuntan al Transaction original que reversan | `schema.prisma:299-336` no tiene `reversesTransactionId` | Para saber qué transaction reversa cuál hay que parsear `description` o inferir por timestamp/expenseId. No es robusto. |
| C5 | Identificadores de Transaction y Transfer son `cuid` no human-friendly | Schema: todos los IDs son cuid | Imposible para un humano referenciar "movimiento TX-2026-00347" en un correo o reporte al contador. |

### 🟠 IMPORTANTES

| # | Gap | Evidencia | Impacto |
|---|---|---|---|
| I1 | `transactionService.update` muta `description`/`reference`/`date` sin audit log | `transactionService.js:169-191` | Cambios en descripciones / fechas de movimientos manuales no quedan registrados. |
| I2 | `payableService.cancel` no pide reason ni crea audit | `payableService.js:226-248` | Una CxC/CxP cancelada no tiene historia. |
| I3 | `payableService.addPayment` no audita el evento de pago | `payableService.js:124-214` | Cada cobro/pago crea Transaction y PayablePayment pero no hay log de "quién aprobó, por qué, observaciones". |
| I4 | Loan y LoanPayment sin audit log | `loanService.js` | Préstamos editables/cancelables sin rastro. |
| I5 | `saleService.cancelSale` no pide reason ni audit log explícito | `saleService.js` | La cancelación queda solo como cambio de stage en VehicleAuditLog, sin contexto financiero. |
| I6 | No existe vista UI de auditoría para Transactions ni Transfers | Grep en `frontend/src/pages/treasury` no halla `audit` ni `Auditoría` | El usuario no puede consultar el historial de un movimiento individual desde la UI; tendría que abrir la DB. |
| I7 | `Account.delete` sin audit log | `accountService.js:69-83` | Aunque restringe si hay transactions, una cuenta nueva vacía se elimina sin rastro. |
| I8 | `expenseService.update` tiene `reason` pero es **opcional** | Joi schema `expenseUpdate.reason` no es required | Ediciones de gastos pueden quedar sin justificación. (En cambio el delete sí es required.) |

### 🟡 MENORES

| # | Gap | Evidencia | Impacto |
|---|---|---|---|
| M1 | Audit logs no graban IP / user-agent de la sesión | `ExpenseAuditLog` / `VehicleAuditLog` no tienen campos `ipAddress` ni `userAgent` | Para auditorías de seguridad, falta contexto de origen. |
| M2 | Sale "lineage" (origen → adjustments → reversals) no consultable en un solo endpoint | Hay que cruzar Transaction.expenseId + Vehicle.id + Payable.vehicleId | El nuevo rollup oculta los ADJUSTMENT/REVERSAL del listing pero no expone un endpoint para verlos cuando el auditor quiera. |
| M3 | CashCount (arqueo de caja) no genera Transaction de ajuste por diferencia | `cashCountService` solo registra el conteo | Si hay diferencia entre saldo esperado y contado, el saldo del sistema no se ajusta y la diferencia queda "fantasma". |
| M4 | No hay forma de marcar una Transaction como "conciliada con extracto bancario" | Schema no tiene `reconciledAt`, `bankRef` | Imposible distinguir movimientos verificados de los pendientes de conciliar. |

---

## 4. Recomendaciones priorizadas

### Fase 1 — Próximo PR (corregir gaps críticos)

1. **Bloquear delete destructivo de Transaction manual / Transfer / Payable; exigir `reason`.**
   **Qué:** Cambiar `DELETE /treasury/transactions/:id` y `/treasury/transfers/:id` para que pidan body `{reason: string ≥10 chars}` validado con Joi. En vez de hard-delete, marcar como `deletedAt` + crear reverso compensatorio (igual que expenses).
   **Por qué:** cierra C1, C2.
   **Esfuerzo:** **M** (migración + service + tests + UI prompt de motivo).

2. **Crear tablas `TransactionAuditLog` y `TransferAuditLog` con campos: id, entityId, userId, action, before(Json), after(Json), reason, createdAt.**
   **Qué:** Migración Prisma + helper `writeAudit` reusable. Llamarlo desde `transactionService.update/delete`, `transferService.create/delete`, `accountService.update/delete`, `payableService.cancel/addPayment`.
   **Por qué:** cierra C3, I1, I2, I3, I7.
   **Esfuerzo:** **L** (varios services + tests).

3. **Agregar columna `reversesTransactionId` a `Transaction` y poblarla al crear EXPENSE_REVERSAL / EXPENSE_ADJUSTMENT.**
   **Qué:** Migración + ajuste en `expenseService.update/delete` para setear la FK. Permite navegar reverso → original.
   **Por qué:** cierra C4.
   **Esfuerzo:** **S** (1 migración + 2 services).

4. **Forzar `reason` obligatorio en `expenseService.update` cuando cambian campos sensibles (amount / accountId / category).**
   **Qué:** Joi update schema con `reason` required si esos campos están en el body.
   **Por qué:** cierra I8.
   **Esfuerzo:** **S**.

### Fase 2 — Siguiente sprint (visibilidad y UX)

5. **Endpoint `GET /treasury/transactions/:id/lineage`** que devuelve la cadena: VEHICLE_EXPENSE original + todos los ADJUSTMENT y REVERSAL con sus IDs, montos, fechas, motivos, usuarios.
   **Esfuerzo:** **M**.

6. **Tab "Auditoría" en `/treasury/transactions/:id` (modal o página)** que muestre el lineage y el audit log del movimiento.
   **Esfuerzo:** **M**.

7. **Tab "Auditoría" en `VehicleDetailPage`** que muestre cronológicamente TODAS las operaciones del vehículo: compra, gastos (con sus reversos), venta, comisiones, transfers a BUDGET. Una sola línea de tiempo.
   **Esfuerzo:** **L**.

8. **Generar `humanId` para Transaction, Transfer, Payable, Loan** con formato `TX-YYYY-NNNNN` (autoincremental por año). Indexable y mostrable junto al cuid.
   **Qué:** columna nueva + secuencia Postgres + trigger / hook en service.
   **Por qué:** cierra C5.
   **Esfuerzo:** **M**.

9. **Audit log para Loan y LoanPayment** (mismo helper `writeAudit`).
   **Por qué:** cierra I4.
   **Esfuerzo:** **S** (una vez que el helper esté).

### Fase 3 — Sprint posterior (controles contables avanzados)

10. **Tabla `Reconciliation`** con `accountId`, `periodStart`, `periodEnd`, `expectedBalance`, `bankBalance`, `difference`, `status`, `closedBy`. Endpoint para "cerrar período" que congela transactions ≤ fecha.

11. **Campo `reconciledAt` y `bankReference` en Transaction** para marcar movimientos conciliados con el extracto bancario. Filtro en `/treasury/transactions` por "no conciliados".

12. **Ajuste automático en `CashCount`** cuando hay diferencia: crear Transaction tipo OTHER_INCOME/OTHER_EXPENSE con categoría `CASH_COUNT_ADJUSTMENT` y vincularla al CashCount.id. Cierra M3.

13. **Campos `ipAddress` y `userAgent` en todos los audit logs** (helper común).

14. **Export contable CSV/PDF** con columnas: humanId, fecha, cuenta, tipo, categoría, descripción, monto, referencia, conciliado_si_no, audit_link.

### Fase 4 — Maduración (long-term)

15. **Doble entrada estricta**: garantizar a nivel servicio que toda transaction tiene contrapartida (suma a cero). Hoy ya se cumple de facto en Transfer y en sale flow, pero no es invariante validado.

16. **Hash chain en Transaction** (`previousHash`, `hash`) para detección de tampering. Cada nueva transaction incluye el hash de la anterior; alterar una rompe la cadena.

---

## 5. Mejores prácticas no implementadas todavía

- **Conciliación bancaria periódica** contra el extracto del banco (matching automático por monto+fecha+referencia).
- **Cierre de período** (lockear transactions anteriores a una fecha; reapertura requiere reason + audit).
- **Doble entrada estricta** validada a nivel service.
- **Segregation of duties** (quien autoriza ≠ quien ejecuta; aplicable para pagos sobre cierto umbral).
- **Workflow de aprobación** para transactions sobre un monto (p. ej. egresos >5M requieren segundo usuario).
- **Period close monthly report** auto-generado y firmado.
- **Hash chain o checksum** sobre la tabla Transaction para detectar tampering directo sobre la DB.
- **Auditoría inmutable** (write-once log replicado, p. ej. a S3 con object lock o a una tabla append-only).
- **Tests de integridad contable** (job nightly que verifica: suma(transactions) por cuenta == calculateBalance, no hay transferId huérfanos, no hay PayablePayment sin Transaction).
- **Backup automatizado** con retention policy y restore probado periódicamente.

---

## Resumen ejecutivo

El sistema tiene **una base sólida de trazabilidad para los flujos centrados en Vehicle y Expense**: ambos cuentan con audit logs dedicados (`VehicleAuditLog`, `ExpenseAuditLog`), reasons en deletes, y vistas de auditoría accesibles desde la UI (`ExpenseAuditModal`, pestaña Historial del vehículo).

**Sin embargo, todo lo que sale de esos dos flujos queda sin trazabilidad:**

- **Transactions manuales** (ingresos / egresos sueltos, aportes de capital) se editan y borran sin rastro.
- **Transfers entre cuentas** se hard-deletan sin pedir motivo ni dejar registro.
- **Saldo inicial de una cuenta** se puede modificar libremente.
- **Reversos** existen como categoría pero no tienen FK al transaction que reversan: solo se infieren por descripción.
- **Pagos de CxC/CxP** no se auditan como evento.
- **Loans** sin audit log.
- **Sin identificadores human-readable** (todo es cuid).
- **Sin vistas de auditoría** en UI para Transactions ni Transfers.

**Top 5 gaps críticos a resolver primero:**

1. **C1/C2**: `DELETE` de Transaction manual y Transfer son hard-delete sin reason ni audit. Imposible reconstruir movimientos borrados.
2. **C3**: `accountService.update` permite modificar saldo inicial sin rastro.
3. **C4**: Reversos sin FK al original (`reversesTransactionId`).
4. **I3/I4**: `payableService.addPayment` y `loanService.*` sin audit log.
5. **I6**: No hay UI de auditoría para Transactions/Transfers.

Solucionar la Fase 1 (4 ítems) requiere **1 migración Prisma + ~6 cambios en services + actualización de 2 rutas + tests** y deja el sistema en un estado **defensible para auditoría externa básica**. Las Fases 2-4 son evoluciones progresivas hacia un sistema de tesorería profesional con conciliación, cierre de período y detección de tampering.

---

**Stop conditions del prompt:** Reporte escrito y commiteado. Esperando autorización del usuario antes de proponer plan de implementación de cualquiera de las recomendaciones.
