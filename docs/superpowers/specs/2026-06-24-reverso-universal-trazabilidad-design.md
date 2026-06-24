# Reverso universal con trazabilidad — Diseño

- **Fecha:** 2026-06-24
- **Estado:** Aprobado (diseño). Pendiente plan de implementación.
- **Autor:** Juan Gómez (con asistencia de Claude)
- **Contexto previo:** Extiende la [política de trazabilidad de tesorería](../../../CLAUDE.md) vigente desde 2026-06-11 (PR #30): movimientos inmutables, audit log polimórfico, timeline unificado del vehículo.

## 1. Objetivo

Permitir **reversar cualquier operación que afecte la tesorería** —movimientos manuales, gastos, transferencias, préstamos, créditos, arqueos y cuentas— de forma intuitiva, siguiendo mejores prácticas de auditoría y contabilidad. Todo reverso queda registrado en el log de auditoría con autor + motivo, y es rastreable desde tres superficies (pantalla central, badge por pantalla, timeline del vehículo).

## 2. Principio rector (no negociable)

**Reversar = asiento compensatorio (storno) + log de auditoría. Nunca se borra ni se edita el original.**

- El registro original queda visible para siempre.
- El reverso es un registro espejo enlazado al original por `reversesTransactionId`, con `reason` (motivo) y autor.
- Aplica uniformemente a todo lo que mueve plata. Las entidades que NO mueven plata (arqueo, cuenta) usan una variante de "anulación con log" descrita en §4.

Esto extiende —no contradice— la política de inmutabilidad ya desplegada.

## 3. Motor de reverso compartido (backend)

Se generaliza el actual `backend/src/utils/transactionReversal.js` a un **motor único** (working name: `reversalEngine`), con lógica pura + un servicio que orquesta Prisma.

Responsabilidades del motor:

1. Recibir la(s) `Transaction` que componen una operación.
2. Construir los movimientos compensatorios: tipo invertido, mismo monto, categoría de reverso correspondiente, `reversesTransactionId` apuntando al original, `description` con referencia (`#abc123`) + motivo, `createdBy`.
3. Ejecutar todo dentro de **una transacción de Prisma atómica** (si una parte falla, no queda medio reverso).
4. Escribir el `TreasuryAuditLog` con `action: REVERSE`, `before`/`after` (snapshot), `reason`, `userId`.
5. Recalcular el estado del agregado padre afectado (saldo de préstamo/crédito, `status`).

Cada dominio solo aporta **"qué transacciones componen esta operación"**. La compensación, atomicidad y log viven en un único lugar (DRY). Esto mantiene cada servicio de dominio delgado y un solo punto a auditar/testear para la lógica crítica.

## 4. Semántica por dominio

| Dominio | Modelo | Acción | Comportamiento |
|---|---|---|---|
| Movimiento manual | `Transaction` | storno | **Ya existe** (`MANUAL_REVERSAL`). Se mantiene; se migra a usar el motor compartido. |
| Gasto | `Expense` | storno | **Ya existe** vía soft-delete → `EXPENSE_REVERSAL`/`EXPENSE_ADJUSTMENT`. Se unifica al mismo botón + log central; no se reconstruye. |
| Transferencia | `Transfer` | storno | Compensa ambas patas (`TRANSFER_IN` + `TRANSFER_OUT`). |
| Préstamo | `Loan` | individual + cascada | Reversar un `LoanPayment` puntual, **o** anular el préstamo completo (desembolso + todos los pagos vivos, cada uno con su compensatorio). |
| Crédito | `Debt` | individual + cascada | Espejo de préstamo: reversar un `DebtPayment`, o anular el crédito completo. |
| Arqueo | `CashCount` | anular registro | Marca `voided` (campos nuevos) + log `CASH_COUNT.REVERSE`. **No genera movimiento** porque el arqueo nunca movió plata. |
| Cuenta | `Account` | desactivar | `isActive = false` + log `ACCOUNT.CANCEL`/`REVERSE`. Bloqueado si saldo ≠ 0 o tiene movimientos. |

Notas:
- "Cuentas" = maestro de cuentas bancarias/caja (`Account`). Las cuentas por pagar (`Payable`) quedan **fuera de alcance** en este spec (ya tienen `CANCEL`).
- El reverso completo de préstamo/crédito reusa el status `CANCELLED` ya existente en `LoanStatus`/`DebtStatus`.

## 5. Guardas (reglas compartidas, aplicadas por el motor/validación)

| Regla | Resultado |
|---|---|
| Solo rol `ADMIN` | `403` |
| Motivo obligatorio, ≥ 10 caracteres | `400` |
| No se reversa un reverso/ajuste (`reversesTransactionId` presente) | `400` |
| No se reversa algo ya reversado | `409` |
| No se reversa el desembolso de un préstamo/crédito con pagos vivos (usar cascada) | `409` |
| Cuenta con saldo ≠ 0 o con movimientos no se puede desactivar | `403` |
| Doble ejecución concurrente del mismo reverso | bloqueada por el índice único parcial existente |

Todas las operaciones de storno son atómicas (Prisma `$transaction`).

## 6. Auditoría y seguimiento (3 superficies)

1. **Pantalla central "Auditoría / Reversos"** (nueva): consume el endpoint `GET /treasury/audit` **extendido**. Lista cronológica de todos los reversos de la app, con filtros por tipo de entidad / fecha / usuario y enlace al original. Columnas: fecha, entidad, descripción, monto, motivo, autor.
2. **Badge + referencia por pantalla**: en cada lista (movimientos, gastos, préstamos, créditos, arqueos, cuentas) el ítem reversado muestra badge "Reversado ✗" y el compensatorio enlaza al original (`← #abc123`). Réplica del patrón actual de movimientos.
3. **Timeline del vehículo**: los reversos ligados a un vehículo siguen apareciendo en la pestaña Historial (ya mezcla auditorías + movimientos cronológicamente). Sin cambios estructurales.

## 7. Cambios de schema (migración aditiva, sin pérdida de datos)

- `TreasuryAuditEntity` += `LOAN`, `LOAN_PAYMENT`, `DEBT_PAYMENT`, `CASH_COUNT` (`DEBT` ya existe).
- `TreasuryAuditAction` += `REVERSE`.
- `TransactionCategory` += `LOAN_REVERSAL`, `DEBT_REVERSAL` (categorías propias para auditar limpio; los movimientos existentes ya tienen `MANUAL_REVERSAL`, `EXPENSE_REVERSAL`).
- `CashCount` += `voidedAt DateTime?`, `voidedBy String?`, `voidReason String?`.
- `Loan` / `Debt`: sin columnas nuevas — se reusa `status = CANCELLED` para "reversado completo".

Migración nombrada siguiendo la convención del repo (ver skill `database-migrations` antes de generarla).

## 8. API (contratos nuevos)

Siguiendo el patrón existente `POST /treasury/transactions/:id/reverse`:

- `POST /loans/:id/reverse` — anula préstamo completo (cascada). Body: `{ reason }`.
- `POST /loan-payments/:id/reverse` — reversa un pago de préstamo. Body: `{ reason }`.
- `POST /debts/:id/reverse` — anula crédito completo (cascada). Body: `{ reason }`.
- `POST /debt-payments/:id/reverse` — reversa un pago de crédito. Body: `{ reason }`.
- `POST /treasury/cash-counts/:id/reverse` — anula arqueo. Body: `{ reason }`.
- `POST /treasury/accounts/:id/reverse` — desactiva cuenta. Body: `{ reason }`.
- `GET /treasury/audit` — **extendido** con filtros `entityType`, `action`, `userId`, `startDate`, `endDate`, paginación.

Todos: `authorize('ADMIN')` + validación Joi (motivo ≥ 10), respuestas `201`/`200` con el resultado, errores con los status de §5. Diseñar contratos con la skill `api-design`.

## 9. UI

- Componente reutilizable `<ReverseAction>` (botón + modal con textarea de motivo + botón confirmar deshabilitado hasta ≥ 10 chars). Réplica del modal actual de movimientos, extraído a componente compartido.
- Componente `<ReversedBadge>` compartido (badge "Reversado" + ref al original).
- Nueva página `AuditLogPage` para la superficie central, con tabla + filtros.
- Flujos críticos / pantallas nuevas → skill `e2e-testing` para Playwright.

## 10. Testing

- **Unit** del `reversalEngine`: construcción de compensatorios, recálculo de saldos, todas las guardas (sin Prisma, lógica pura — patrón de los tests actuales de audit).
- **E2E** por dominio (UI + API) replicando `tests/e2e/treasury/transaction-reverse-*.spec.ts`: happy path + cada guarda (`400`/`403`/`409`).
- Aislado en DB `autocontrol_test`.
- No eliminar los tests de regresión de inmutabilidad existentes.
- Cobertura objetivo ≥ 80%.

## 11. Orden de construcción (fases)

1. **Motor de reverso + schema/migración** (base compartida; migra el reverso de movimientos al motor sin cambiar su comportamiento observable).
2. **Préstamos** (individual + cascada).
3. **Créditos** (espejo de préstamos).
4. **Arqueos** y **Cuentas** (semánticas simples).
5. **Pantalla central de Auditoría** (endpoint extendido + página).
6. **Unificación**: gasto/transferencia al motor + `<ReversedBadge>` en todas las listas.

Cada fase es entregable y testeable de forma independiente.

## 12. Fuera de alcance (YAGNI)

- Reverso de cuentas por pagar (`Payable`) — ya tiene `CANCEL`.
- Bloqueos por período contable cerrado (period locks) — se puede evaluar después si surge la necesidad.
- Reverso por parte de roles distintos a ADMIN.
