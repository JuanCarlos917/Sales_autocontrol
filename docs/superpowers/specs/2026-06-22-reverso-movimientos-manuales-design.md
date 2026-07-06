# Reverso de movimientos manuales — Diseño

**Fecha:** 2026-06-22
**Estado:** Aprobado (pendiente de plan de implementación)

## Contexto

AutoControl es un sistema de gestión financiera para compra/venta de vehículos.
La tesorería registra cada movimiento como un `Transaction` (modelo Prisma en
`backend/prisma/schema.prisma`).

Por política vigente (desplegada en producción, PR #30, ver memoria
`treasury-traceability-policy`), **los movimientos son inmutables**: no existe
`DELETE` de transacciones. Las correcciones se hacen creando movimientos
compensatorios que dejan rastro. Ya existe la infraestructura de reverso para
gastos: la self-FK `Transaction.reversesTransactionId` y los tipos de categoría
`EXPENSE_ADJUSTMENT` / `EXPENSE_REVERSAL`, que la UI pinta con badges.

## Objetivo

Permitir que el rol **ADMIN** reverse un **movimiento manual** desde la UI para
corregir errores, viendo un identificador corto por movimiento y dejando rastro
auditable. El reverso **no borra**: crea un movimiento compensatorio.

## Decisiones de alcance (acordadas)

1. **Solo movimientos manuales son reversables.** No se reversan movimientos
   ligados a otra entidad (gasto, préstamo, deuda, pago de payable,
   transferencia), para no descuadrar esas entidades. Opción más segura.
2. **Identificador corto = código del cuid** (`#abc123`), reutilizando la
   convención que la UI ya usa. No se agrega secuencia autoincremental.
3. **Guardas:** motivo obligatorio (≥10 chars) y prevención de doble reverso.
   **No** se valida saldo (se permite que el saldo quede negativo si la
   corrección lo requiere).
4. Solo **ADMIN** puede ver y ejecutar el reverso.

## Qué es reversable

Un `Transaction` es reversable solo si cumple **todo**:

- Es manual: `expenseId`, `loanId`, `loanPaymentId`, `debtId`, `transferId` en
  `null` y sin relación `payablePayment`.
- No es a su vez un reverso/ajuste: `reversesTransactionId` en `null`.
- No fue reversado ya: la relación `reversedBy` está vacía (evita doble reverso).

## Backend

### Schema (migración aditiva)

Agregar el valor `MANUAL_REVERSAL` al enum `TransactionCategory`. Es una
migración aditiva de bajo riesgo. Se usa como categoría del movimiento
compensatorio para mantener correcto el reporte de `getSummary` (el reverso
neutraliza el original en `netFlow` sin inflar la categoría original).

> Alternativa descartada: reusar `EXPENSE_REVERSAL`, que está semánticamente
> atado a gastos de vehículo y ensuciaría la auditoría de movimientos manuales.

### Endpoint

`POST /treasury/transactions/:id/reverse`

- **Auth:** ADMIN only (middleware de roles existente).
- **Body:** `{ reason: string }` — validación Joi en `middleware/validation.js`,
  `reason` requerido, mínimo 10 caracteres.
- **Respuesta:** el movimiento compensatorio creado (envelope estándar del
  proyecto).

### Service (`transactionService.reverse(id, reason, userId)`)

Dentro de un `prisma.$transaction`:

1. Cargar el movimiento original; si no existe → `AppError 404`.
2. Validar que es reversable (ver reglas arriba). Si no:
   - Ligado a otra entidad → `AppError 403` con mensaje claro.
   - Es un reverso/ajuste → `AppError 400`.
   - Ya reversado → `AppError 409`.
3. Crear movimiento compensatorio:
   - `accountId`, `amount` iguales al original.
   - `type` invertido: `INCOME` → `EXPENSE`, `EXPENSE` → `INCOME`.
   - `category = MANUAL_REVERSAL`.
   - `reversesTransactionId = id` del original.
   - `description` = motivo + referencia corta al original.
   - `createdBy = userId` (admin).
4. Escribir en `treasury_audit_logs` vía el helper `treasuryAudit.js`
   (autor + motivo), consistente con la política de trazabilidad.

### Códigos de estado

| Caso | Status |
|---|---|
| Reverso exitoso | 201 |
| Movimiento no existe | 404 |
| Movimiento ligado a entidad | 403 |
| Movimiento es reverso/ajuste | 400 |
| Movimiento ya reversado | 409 |
| Motivo faltante o <10 chars | 400 (validación Joi) |
| Usuario no ADMIN | 403 |

## Frontend

- En la lista de movimientos (`/treasury/transactions`): cada fila muestra su
  código corto `#abc123` (reúso de la convención existente).
- Botón **"Reversar"** por fila, visible **solo para ADMIN** y solo en
  movimientos reversables (manual, no reversado, no es reverso).
- Al hacer clic → modal con detalle del movimiento + textarea **"Motivo"**
  obligatorio (≥10 chars, deshabilita confirmar si no cumple). Confirmar →
  `POST` → refetch de la lista.
- El original reversado muestra badge gris **"Reversado"**.
- El movimiento compensatorio se pinta como **"Reverso → #abc123"** (la lógica
  de badge por `reversesTransaction` ya existe).

Para distinguir el estado "reversado" en la UI, el endpoint de listado debe
incluir si cada transacción tiene `reversedBy` (p. ej. un flag o el conteo de la
relación) en `TRANSACTION_INCLUDE`.

## Tests (TDD)

### Unit (service)

- Detecta correctamente movimiento reversable vs. no reversable.
- Invierte el tipo (INCOME↔EXPENSE) y conserva monto/cuenta.
- Rechaza doble reverso.
- Rechaza motivo <10 chars.
- Rechaza movimiento ligado a entidad.
- Rechaza reversar un movimiento que ya es reverso/ajuste.

### Integración (endpoint)

- non-admin → 403.
- happy path → 201 + compensatorio creado + audit log escrito.
- id inexistente → 404.
- ya reversado → 409.
- ligado a entidad → 403.

### E2E (Playwright)

- ADMIN ve y usa el botón "Reversar"; aparece el badge "Reversado".
- non-admin (VIEWER) no ve el botón.
- El modal exige motivo antes de confirmar.

## Skills obligatorias del proyecto a invocar

Según `CLAUDE.md`: `tdd-workflow` (antes de código), `database-migrations`
(enum nuevo), `api-design` (contrato del endpoint), `e2e-testing` (Playwright),
`verification-loop` (antes de marcar completo).

## Fuera de alcance (YAGNI)

- Reverso de movimientos ligados a entidades (préstamos, gastos, payables,
  transferencias).
- Identificador secuencial autoincremental.
- Validación/bloqueo de saldo negativo al reversar.
- Reverso del reverso.
