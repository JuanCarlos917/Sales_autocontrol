# Gastos: edit-first, soft delete, audit y lock por VENDIDO — Design Spec

- **Fecha**: 2026-05-18
- **Estado**: Aprobado por usuario, listo para implementación
- **Autor**: brainstorming session

## Contexto

Hoy `/expenses` permite borrar gastos sin fricción. El delete cascade-revierte la transacción de tesorería pero no deja huella: un borrado accidental destruye el rastro contable. Adicionalmente, los gastos de un vehículo VENDIDO siguen editables/borrables, lo que rompe la coherencia de la tesorería histórica (un vehículo "cerrado" debería ser inmutable).

Objetivos:
1. Hacer el delete intencional, auditable y reversible por un corto tiempo.
2. Permitir editar campos financieros generando un ajuste compensatorio en lugar de mutar silenciosamente el saldo.
3. Bloquear cualquier mutación de gastos / transacciones / vehículo cuando el vehículo está en VENDIDO.
4. Cerrar bypass por `/treasury/transactions` para Transactions ligadas a un gasto.

## Decisiones tomadas

| Pregunta | Respuesta |
|---|---|
| Delete | Soft delete + reason + audit + toast "Deshacer" 5 min |
| Edit amount/account/date en gasto pagado | Permitido, genera Transaction de ajuste compensatoria |
| Edit campos no financieros | Permitido siempre, salvo VENDIDO |
| VENDIDO bloquea | edit + delete + crear gastos nuevos + borrar vehículo |
| VENDIDO en kanban | one-way: drag fuera de VENDIDO bloqueado, sin override |
| Bypass por /treasury | Transaction con `expenseId` no se edita ni borra suelta |
| Audit | Tabla `ExpenseAuditLog` con `userId`, `action`, `before`, `after`, `reason`, `createdAt` |
| Override admin | No hay. La regla es plana para todos. |
| Gastos fijos prorrateados | Out of scope |

## Schema

### Cambios en `Expense`

```prisma
model Expense {
  id          String          @id @default(cuid())
  vehicleId   String
  vehicle     Vehicle         @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  accountId   String
  account     Account         @relation(fields: [accountId], references: [id])
  category    ExpenseCategory
  amount      Decimal         @db.Decimal(15, 2)
  description String?
  notes       String?
  date        DateTime?
  paid        Boolean         @default(true)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  createdBy   String?         // NUEVO — null para gastos legacy
  updatedBy   String?         // NUEVO
  deletedAt   DateTime?       // NUEVO — soft delete
  deletedBy   String?         // NUEVO

  payable     Payable?
  auditLogs   ExpenseAuditLog[]  // NUEVO

  @@index([vehicleId])
  @@index([category])
  @@index([accountId])
  @@index([deletedAt])
  @@map("expenses")
}
```

### Nueva tabla `ExpenseAuditLog`

```prisma
model ExpenseAuditLog {
  id        String   @id @default(cuid())
  expenseId String
  expense   Expense  @relation(fields: [expenseId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  action    ExpenseAuditAction
  before    Json?    // snapshot del estado anterior (null en CREATE)
  after     Json?    // snapshot del estado nuevo (null en DELETE)
  reason    String?  // requerido para DELETE, opcional en EDIT
  createdAt DateTime @default(now())

  @@index([expenseId])
  @@index([userId])
  @@index([createdAt])
  @@map("expense_audit_logs")
}

enum ExpenseAuditAction {
  CREATE
  UPDATE
  DELETE
  RESTORE
}
```

### Migración

- Agregar columnas a `expenses` (todas nullable, sin backfill).
- Crear tabla `expense_audit_logs` con índices.
- Sin alterar datos existentes.

## Backend

### Policy de edit por campo

| Campo | Pagado al momento (`paid=true`) | Con CxP, `paidAmount=0` | Con CxP, `paidAmount>0` |
|---|---|---|---|
| `amount` | Edit + crea Transaction de ajuste | Edit + actualiza `Payable.totalAmount` | **BLOQUEADO** |
| `accountId` | Edit + crea 2 Transactions de ajuste (reverso old + cargo new) | Edit directo | **BLOQUEADO** |
| `date` | Edit + actualiza Transaction.date | Edit directo | Edit directo |
| `category` | Edit libre | Edit libre | Edit libre |
| `description` | Edit libre | Edit libre | Edit libre |
| `notes` | Edit libre | Edit libre | Edit libre |
| `vehicleId` | **NUNCA** (cambiaría dueño del gasto) | **NUNCA** | **NUNCA** |

### Transacción de ajuste (cuando cambia `amount`)

- Nueva Transaction con:
  - `category: 'EXPENSE_ADJUSTMENT'` (nuevo enum value)
  - `amount = newAmount - oldAmount` (puede ser positivo o negativo)
  - `type: 'EXPENSE'` si delta > 0, `'INCOME'` si delta < 0
  - `expenseId: <mismo gasto>`
  - `description: "Ajuste de gasto: <descripcion original>"`
- La Transaction original NO se toca (queda como huella histórica).

### Cuando cambia `accountId`

- Reverso atómico en la cuenta vieja (Transaction `INCOME` por amount completo, `category: 'EXPENSE_ADJUSTMENT'`)
- Cargo en la cuenta nueva (Transaction `EXPENSE` por amount completo, `category: 'EXPENSE_ADJUSTMENT'`)
- Ambas dentro de `prisma.$transaction`.

### Soft delete

- `deletedAt = now()`, `deletedBy = userId`.
- Reversa la Transaction original creando un Transaction `INCOME` por el monto, `category: 'EXPENSE_REVERSAL'`, con `expenseId` y `description: "Reverso por borrado: <descripcion>"`.
- Si había `Payable` activa, se cancela (`status: 'CANCELLED'`) — los `PayablePayment` existentes generan sus propios reversos análogos.
- `findAll()` filtra `deletedAt: null` por default. Hay un endpoint `?includeDeleted=true` solo para una vista admin (out of scope este sprint, pero el filtro está listo).

### Restore (undo)

- `POST /api/expenses/:id/restore` con check: solo restaurable si `deletedAt` está dentro de los últimos 5 minutos.
- Borra los Transaction de reverso, des-cancela el Payable, limpia `deletedAt`/`deletedBy`.
- Escribe `ExpenseAuditLog` con action `RESTORE`.

### Audit log: cuándo se escribe

| Operación | Action | `before` | `after` | `reason` |
|---|---|---|---|---|
| `createWithTreasury` | CREATE | null | snapshot | null |
| `update` (cualquier campo) | UPDATE | snapshot pre-edit | snapshot post-edit | opcional |
| `delete` (soft) | DELETE | snapshot pre-delete | null | **requerido** |
| `restore` | RESTORE | snapshot durante delete | snapshot restaurado | null |

### Lock por VENDIDO

Guard reusable `assertVehicleEditable(vehicleId)` que tira `AppError('Vehículo VENDIDO: no se permiten cambios en gastos', 403)`.

Se invoca en:
- `expenseService.createWithTreasury` antes de crear.
- `expenseService.update` antes de editar.
- `expenseService.delete` antes de soft-deletar.
- `expenseService.restore` antes de restaurar.
- `vehicleService.delete` cuando el vehículo está en VENDIDO.
- `transactionService.update` / `transactionService.delete` si la Transaction tiene `expenseId` no-null (independiente del stage).
- Endpoint `move-stage` del Kanban: si `currentStage === 'VENDIDO' && targetStage !== 'VENDIDO'` → 403.

### Bloqueo de Transactions ligadas

Transactions con `expenseId !== null` no se pueden editar ni borrar desde `/api/transactions/:id`. El único camino para tocarlas es operar sobre el gasto (que tiene sus propias reglas).

## Frontend

### Acción primaria en card de gasto

- Antes: botón "Eliminar" rojo prominente.
- Ahora: botón "Editar" como acción primaria. "Eliminar" pasa a un menú de overflow (3 puntitos) con icono y separador visual.

### Modal de delete

- Título: "Eliminar gasto".
- Campo obligatorio: "Motivo del borrado" (textarea, mín 10 caracteres).
- Resumen: monto, fecha, cuenta — para confirmar visualmente que es el correcto.
- Botón "Eliminar" rojo, deshabilitado hasta llenar el motivo.

### Toast "Deshacer"

- Después del soft delete: toast persistente abajo a la derecha.
- Contenido: "Gasto eliminado · [Deshacer]".
- Duración: 5 min reales (no se cierra solo). Click en "Deshacer" llama `POST /restore`.
- Si pasan los 5 min, el botón cambia a "Tiempo expirado".

### Modal de edit

- Pre-llena con valores actuales.
- Campo `reason` opcional (textarea).
- Si va a cambiar `amount` y el gasto está pagado: muestra warning amarillo "Esto creará una transacción de ajuste por $X en la cuenta Y".
- Si `payable.paidAmount > 0` y el campo `amount` se intenta tocar: el input queda disabled con tooltip "No editable, ya tiene pagos parciales".

### Lock visual cuando vehículo está en VENDIDO

- Cada card de gasto muestra badge 🔒 "Vehículo vendido" en lugar de los botones.
- En el detail del vehículo (tab Gastos): banner top "Este vehículo está VENDIDO. Los gastos son de solo lectura."
- Botón "Nuevo gasto" deshabilitado con tooltip "Vehículo vendido: no se pueden agregar gastos".
- Botón "Eliminar vehículo" deshabilitado con tooltip equivalente.

### Audit history (vista mínima)

- En el detail del gasto, tab/sección "Historial".
- Lista cronológica DESC con: fecha, usuario, acción, motivo (si hay), diff visual de campos cambiados.

### Kanban: bloqueo de drag desde VENDIDO

- Si `vehicle.stage === 'VENDIDO'` y el target es otra columna, no se permite el drop.
- Toast/alert: "VENDIDO es un estado final. No se puede mover."

## Tests E2E

- `tests/e2e/expenses/edit-with-adjustment.spec.ts` — editar amount de un gasto pagado verifica que se crea Transaction de ajuste y la suma de movs de la cuenta = nuevo amount.
- `tests/e2e/expenses/soft-delete-and-undo.spec.ts` — borrar → undo dentro de 5 min restaura el gasto y revierte los reversos.
- `tests/e2e/expenses/vendido-lock.spec.ts` — vehículo en VENDIDO: 403 en create/update/delete del gasto, 403 en delete del vehículo, drag desde VENDIDO bloqueado.
- `tests/e2e/expenses/treasury-bypass-blocked.spec.ts` — intento de DELETE / PUT sobre Transaction con expenseId → 403.

## Plan de sprints

| # | Alcance | Tamaño |
|---|---|---|
| E.1 | Schema + migración (Expense fields, ExpenseAuditLog) | ~30 min |
| E.2 | Backend `update` policy + adjustment Transaction, soft delete + `restore`, audit en todas las mutaciones | ~60 min |
| E.3 | Lock VENDIDO en Expense / Vehicle.delete / Transaction.update+delete / Kanban move | ~45 min |
| E.4 | Frontend: edit-first, modal motivo, toast undo, badges 🔒, banner VENDIDO, vista historial | ~45 min |
| E.5 | 4 specs E2E | ~30 min |

Total: **~3.5 h** funcional + auditado + testeado.

## Cambios a archivos

| Archivo | Cambio |
|---|---|
| `backend/prisma/schema.prisma` | + 4 fields en Expense, + `ExpenseAuditLog`, + 1 enum, + 2 enum values en TransactionCategory |
| `backend/prisma/migrations/...` | NUEVO |
| `backend/src/services/expenseService.js` | Reescribir `update` / `delete`, agregar `restore`, agregar `assertVehicleEditable`, agregar `writeAudit` helper |
| `backend/src/services/vehicleService.js` | Guard en `delete` |
| `backend/src/services/transactionService.js` | Guard en `update` / `delete` si `expenseId` |
| `backend/src/services/saleService.js` ó equivalente | Guard en `moveStage` cuando from=VENDIDO |
| `backend/src/controllers/expenseController.js` | + endpoint `restore` |
| `backend/src/routes/expenses.js` | + ruta |
| `backend/src/middleware/validation.js` | + schema para `restore` y `reason` |
| `frontend/src/pages/ExpensesPage.jsx` | UX edit-first, lock visual |
| `frontend/src/components/expenses/ExpenseFormModal.jsx` | warning de ajuste, disabled de amount si CxP parcial |
| `frontend/src/components/expenses/ExpenseDeleteModal.jsx` | NUEVO — modal con motivo |
| `frontend/src/components/expenses/UndoDeleteToast.jsx` | NUEVO — toast 5 min |
| `frontend/src/components/expenses/ExpenseAuditHistory.jsx` | NUEVO — vista historial |
| `frontend/src/pages/KanbanPage.jsx` | Guard drag desde VENDIDO |
| `frontend/src/pages/VehicleDetailPage.jsx` | Banner VENDIDO, disabled botones |
| `tests/e2e/expenses/*.spec.ts` | 4 specs nuevos |

## Out of scope (YAGNI)

- Vista admin "Gastos archivados" con filtro de soft-deleted (el filtro queda listo en el endpoint).
- Override de admin sobre el lock VENDIDO (la regla es plana).
- Diff visual sofisticado en el audit history (lista de campos cambiados está bien, no necesita color-coded JSON diff).
- Edición masiva de gastos.
- Notificaciones cuando alguien edita un gasto.
- Reglas distintas por rol (todos los usuarios autenticados siguen las mismas reglas).
- Lock por otras etapas (solo VENDIDO bloquea).
- Gastos fijos prorrateados (sistema aparte).
