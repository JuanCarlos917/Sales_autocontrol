# Préstamos internos — Design Spec

- **Fecha**: 2026-05-02
- **Estado**: Aprobado por usuario, pendiente plan de implementación
- **Autor**: brainstorming session

## Contexto

AutoControl ya gestiona compras y ventas de vehículos con su flujo completo de tesorería (CxP, CxC, transferencias, cuentas, terceros). No existe hoy un mecanismo para registrar **préstamos internos**: dinero que se saca de una cuenta del sistema para entregar a una persona (socio, empleado, externo) y que se devuelve en cuotas, opcionalmente con un monto extra voluntario.

El objetivo es agregar este flujo con trazabilidad contable completa, separado del modelo `Payable` para no sobrecargarlo con conceptos de cronograma e ingresos extra.

## Decisiones tomadas en brainstorming

| Pregunta | Respuesta |
|---|---|
| Manejo de cuotas | **Híbrido**: cronograma definido al crear, pagos pueden ser por monto distinto al planeado. |
| Intereses | **Sin intereses** (capital puro). |
| Quién puede ser deudor | Cualquier `ThirdParty`. Se agrega tipo nuevo `EMPLOYEE` para identificar empleados. El selector permite crearlos en el momento. |
| Construcción del cronograma | **Automático con edición**: usuario indica `# cuotas` + frecuencia + primera fecha; sistema genera; usuario puede ajustar fechas/montos individuales antes de confirmar. |
| Monto extra del deudor | Campo opcional en cada pago. NO reduce el saldo del préstamo. Se registra como transacción independiente con categoría `LOAN_EXTRA_INCOME` (etiqueta tipo "Ingreso extra del préstamo"). |
| Modelo de datos | Modelo dedicado `Loan` + `LoanInstallment` + `LoanPayment` (separado de `Payable`). |

## Esquema de datos

### Enums (Prisma)

```prisma
enum LoanStatus {
  PENDING     // desembolsado, sin pagos
  PARTIAL     // con pagos, no completado
  PAID        // capital totalmente devuelto
  CANCELLED   // anulado antes de cierre
}

enum InstallmentStatus {
  PENDING
  PARTIAL
  PAID
}

enum ThirdPartyType {
  CLIENT
  SUPPLIER
  PARTNER
  EMPLOYEE   // NUEVO
  BOTH
}

// Valores nuevos en TransactionCategory:
//   LOAN_DISBURSEMENT      → EXPENSE al desembolsar el préstamo
//   LOAN_REPAYMENT         → INCOME por cuota recibida (cuenta como principal)
//   LOAN_EXTRA_INCOME      → INCOME por monto extra voluntario del deudor
```

### Tablas nuevas

```prisma
model Loan {
  id               String      @id @default(cuid())
  borrowerId       String
  originAccountId  String
  principalAmount  Decimal     @db.Decimal(15, 2)
  paidAmount       Decimal     @default(0) @db.Decimal(15, 2)   // solo principal
  extraReceived    Decimal     @default(0) @db.Decimal(15, 2)   // acumulado de extras
  status           LoanStatus  @default(PENDING)
  description      String?
  disbursementDate DateTime    @default(now())
  notes            String?
  createdBy        String
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  borrower         ThirdParty  @relation("LoanBorrower", fields: [borrowerId], references: [id])
  originAccount    Account     @relation("LoanOriginAccount", fields: [originAccountId], references: [id])
  installments     LoanInstallment[]
  payments         LoanPayment[]
  transactions     Transaction[]   // disbursement + repayments referenciadas

  @@map("loans")
}

model LoanInstallment {
  id            String             @id @default(cuid())
  loanId        String
  sequence      Int                // 1, 2, 3...
  dueDate       DateTime
  plannedAmount Decimal            @db.Decimal(15, 2)
  paidAmount    Decimal            @default(0) @db.Decimal(15, 2)
  status        InstallmentStatus  @default(PENDING)

  loan          Loan               @relation(fields: [loanId], references: [id], onDelete: Cascade)

  @@unique([loanId, sequence])
  @@map("loan_installments")
}

model LoanPayment {
  id              String       @id @default(cuid())
  loanId          String
  accountId       String       // cuenta destino (efectivo o consignación)
  principalAmount Decimal      @db.Decimal(15, 2)
  extraAmount     Decimal      @default(0) @db.Decimal(15, 2)
  date            DateTime     @default(now())
  notes           String?
  createdBy       String
  createdAt       DateTime     @default(now())

  loan            Loan         @relation(fields: [loanId], references: [id], onDelete: Cascade)
  account         Account      @relation("LoanPaymentAccount", fields: [accountId], references: [id])
  transactions    Transaction[]   // 1 si extra=0, 2 si extra>0

  @@map("loan_payments")
}
```

### Modificaciones a entidades existentes

```prisma
model Transaction {
  // ...campos existentes...
  loanId          String?
  loan            Loan?        @relation(fields: [loanId], references: [id])
  loanPaymentId   String?
  loanPayment     LoanPayment? @relation(fields: [loanPaymentId], references: [id])
}

model Account {
  // ...
  loans           Loan[]        @relation("LoanOriginAccount")
  loanPayments    LoanPayment[] @relation("LoanPaymentAccount")
}

model ThirdParty {
  // ...
  loansAsBorrower Loan[]        @relation("LoanBorrower")
}
```

## Semántica de status

### `Loan.status` — actualizado on-write

Recalculado dentro del `prisma.$transaction` después de cada `LoanPayment`:

- `paidAmount = 0` → `PENDING`
- `0 < paidAmount < principalAmount` → `PARTIAL`
- `paidAmount >= principalAmount` → `PAID`
- `CANCELLED` solo via endpoint explícito.

### `LoanInstallment.status` — actualizado on-write

Cuando un `LoanPayment` aplica monto a la cuota:

- `paidAmount = 0` → `PENDING`
- `0 < paidAmount < plannedAmount` → `PARTIAL`
- `paidAmount >= plannedAmount` → `PAID`

### `OVERDUE` — computado en lectura

NO se almacena. El service computa al responder:

```js
const isOverdue = loan.status !== 'PAID' && loan.status !== 'CANCELLED' &&
  loan.installments.some(i => i.status !== 'PAID' && i.dueDate < new Date());
```

Esto evita drift sin necesidad de cron job.

## Política de aplicación de pagos a cuotas

Cuando se registra un `LoanPayment` con `principalAmount = X`:

1. Iterar `installments` por `sequence ASC` (cuota más vieja primero).
2. Cada cuota toma hasta `plannedAmount - paidAmount`. Si sobra, pasa a la siguiente.
3. Si `X` excede el saldo pendiente del préstamo (`principalAmount - paidAmount`): **error 400**, forzar al usuario a usar `extraAmount` para el sobrante.
4. `extraAmount` NO toca cuotas. Va directo a `loan.extraReceived` y a una transacción independiente con categoría `LOAN_EXTRA_INCOME`.

## Endpoints API

| Verb | Path | Descripción |
|---|---|---|
| `POST` | `/api/loans` | Crea préstamo + cuotas + 1 transacción de desembolso (atómico). |
| `GET` | `/api/loans` | Lista. Filtros: `status`, `borrowerId`, `overdueOnly`. Computa OVERDUE en lectura. |
| `GET` | `/api/loans/:id` | Detalle: préstamo + cuotas + pagos + transacciones. |
| `POST` | `/api/loans/:id/payments` | Registra cuota. Aplica principal a cuotas viejas → nuevas. Extra a `LOAN_EXTRA_INCOME`. |
| `POST` | `/api/loans/:id/cancel` | Marca CANCELLED. No mueve dinero. |

### Joi schemas

```js
// loanCreate
{
  borrowerId: Joi.string().required(),
  originAccountId: Joi.string().required(),
  principalAmount: Joi.number().positive().required(),
  description: Joi.string().max(500).allow('', null),
  notes: Joi.string().max(2000).allow('', null),
  installments: Joi.array().items(Joi.object({
    sequence: Joi.number().integer().positive().required(),
    dueDate: Joi.date().required(),
    plannedAmount: Joi.number().positive().required(),
  })).min(1).required(),
}

// loanPayment
{
  accountId: Joi.string().required(),
  principalAmount: Joi.number().min(0).required(),
  extraAmount: Joi.number().min(0).default(0),
  date: Joi.date().allow(null),
  notes: Joi.string().max(500).allow('', null),
}
```

### Validaciones a nivel servicio

- **`POST /loans`**:
  - Suma de `installments[].plannedAmount` debe igualar `principalAmount` (tolerancia 0).
  - Cuenta origen debe tener `balance computado >= principalAmount` (usar `accountService.calculateBalance`).
  - `borrowerId` debe existir y estar activo.
- **`POST /loans/:id/payments`**:
  - Loan debe existir y `status NOT IN (CANCELLED, PAID)`.
  - `principalAmount + extraAmount > 0`.
  - `principalAmount <= (loan.principalAmount - loan.paidAmount)` o error 400.
  - `principalAmount = 0 + extraAmount > 0` es válido (solo extra, sin tocar cuotas).
- **`POST /loans/:id/cancel`**:
  - Solo permitido si `status = PENDING` (sin pagos aún). Si hay pagos, error 400 con mensaje claro.

## UX — frontend

### Página `/treasury/loans`

Layout similar a `PayablesPage`. Header con resumen (total prestado, devuelto, pendiente, vencidos). Tabs: Activos / Vencidos / Pagados / Todos. Grid de cards: borrower, monto, status, próxima cuota, botón "Registrar pago". Botón "+ Nuevo préstamo".

### Modal `NewLoanModal`

- `ThirdPartySelector` sin `filterType` — acepta cualquier tipo. Permite crear nuevo en el momento (usuario elige tipo entre CLIENT/SUPPLIER/PARTNER/EMPLOYEE/BOTH). Requiere agregar la opción **EMPLOYEE** al `<select>` de tipo dentro del componente.
- Cuenta origen: `<select>` con cuentas activas.
- Monto principal: `<input type="number">`.
- Generador de cronograma: `# cuotas`, frecuencia (mensual/quincenal/semanal), primera fecha. Botón "Generar".
- Tabla editable: filas `sequence | dueDate (date) | plannedAmount (number)`. Recalcula suma en vivo. Validación visual si suma ≠ principal.
- Notas, descripción.
- Submit → POST `/api/loans`.

### Modal `LoanPaymentModal`

- Resumen: saldo pendiente del préstamo, próxima cuota.
- Cuenta destino: `<select>`.
- Monto principal: default = monto pendiente de próxima cuota; editable.
- Monto extra: opcional, etiquetado "Ingreso adicional voluntario (no descuenta saldo)".
- Fecha, notas.
- Submit → POST `/api/loans/:id/payments`.

### Detalle `/treasury/loans/:id` (Sprint L.4 / opcional)

- Header con borrower + saldos + status + próxima cuota.
- Tabla cuotas: sequence, dueDate, planned, paid, status (con badge OVERDUE si aplica).
- Historial de pagos.
- Lista de transacciones asociadas (audit trail visible al usuario).

### Navegación

Agregar link "Préstamos" en sidebar de tesorería (`AppLayout`).

### `data-testid` mínimos

- `loans-create-button` — abrir NewLoanModal.
- `loan-card-{id}` — cada card.
- `loan-card-{id}-pay-button` — abrir LoanPaymentModal.
- `loan-form-borrower`, `loan-form-account`, `loan-form-principal`, `loan-form-installments-count`, `loan-form-frequency`, `loan-form-first-date`, `loan-form-generate`, `loan-form-submit`.
- `loan-payment-account`, `loan-payment-principal`, `loan-payment-extra`, `loan-payment-submit`.

## Trazabilidad / audit trail

- Cada `Loan`, `LoanPayment`, `LoanInstallment` tiene `createdBy` (FK a `User`) y `createdAt`.
- Cada `Transaction` derivada (disbursement, repayment, extra) referencia `loanId` y/o `loanPaymentId`. Permite reconstruir el flujo: `Loan → LoanPayment[] → Transaction[]`.
- Toda mutación dentro de `prisma.$transaction` para atomicidad.
- `cancel` no borra nada — marca `CANCELLED` y queda registrado.
- **Descripciones de transacciones** (siempre el mismo formato para auditar fácil):
  - Disbursement: `"Préstamo a {borrower.name}"`
  - Repayment: `"Pago préstamo {loan.id corto o secuencia}: {borrower.name}"`
  - Extra: `"Ingreso extra del préstamo {loan.id corto}: {borrower.name}"`
- **Invariante de `Loan.paidAmount`** (almacenado, no computado, por simplicidad y rendimiento): siempre `loan.paidAmount = SUM(loan.payments[].principalAmount)` — garantizado porque el único path de escritura es `loanService.addPayment` dentro de un `prisma.$transaction`. A diferencia de `Account.currentBalance`, no hay múltiples fuentes de mutación.

## Tests E2E (orden de implementación)

1. **Happy path**:
   - Crear préstamo $5M, 5 cuotas mensuales de $1M.
   - Verificar: 1 EXPENSE LOAN_DISBURSEMENT, balance origen − $5M, 5 installments PENDING.
   - Registrar 1 pago de $1M sobre cuota 1.
   - Verificar: 1 INCOME LOAN_REPAYMENT, balance destino + $1M, cuota 1 PAID, loan.paidAmount = 1M, loan.status = PARTIAL.
2. **Pago con extra**:
   - Sobre el préstamo del test 1, registrar pago $1M principal + $200K extra.
   - Verificar: 2 transacciones (LOAN_REPAYMENT + LOAN_EXTRA_INCOME), balance destino + $1.2M, loan.paidAmount = 2M, loan.extraReceived = 200K.
3. **Validación**:
   - Sobre préstamo con saldo $4M pendiente, intentar pagar $10M principal → error 400.

## Plan de sprints

| Sprint | Alcance | Tamaño |
|---|---|---|
| **L.1 Backend foundation** | Migration + schema (3 tablas + enums + FKs) + ThirdPartyType.EMPLOYEE + TransactionCategory enum + `loanService` + 5 endpoints + Joi validation | ~90 min |
| **L.2 Frontend happy path** | LoansPage + NewLoanModal + LoanPaymentModal + sidebar link + treasuryApi loans helpers + data-testids | ~90 min |
| **L.3 Tests E2E** | 3 specs (helpers `apiCreateLoan`, `apiListLoans`, `apiAddLoanPayment`) | ~45 min |
| **L.4 Polish** (opcional, separable) | Detalle del préstamo, indicador OVERDUE en UI, cancel button, próxima cuota destacada | ~60 min |

Total para feature funcional + testeado: **~3.5 h** (sin L.4).

## Out of scope (YAGNI)

Decisiones explícitas para NO implementar ahora:

- **Intereses** (simples o compuestos). Si se necesitan, agregar campo `interestRate` al `Loan` y recalcular `installments[].plannedAmount` en backend.
- **Refinanciación** (cambiar cronograma de un préstamo activo).
- **Pagos parciales que pisan varias cuotas con monto distribuido manualmente** (UI permite solo monto único; servicio aplica FIFO).
- **Notificaciones** de cuota próxima a vencer.
- **Reporte exportable** de préstamos (CSV).
- **Préstamos en sentido inverso** (terceros prestando a la empresa) — sería un modelo análogo o reuso si el caso aparece.

## Cambios a archivos existentes (estimado)

| Archivo | Cambio |
|---|---|
| `backend/prisma/schema.prisma` | + 3 tablas + 2 enums + valores en 2 enums existentes + relaciones inversas en Account, ThirdParty, Transaction |
| `backend/prisma/migrations/...` | Nueva migration `add_internal_loans` |
| `backend/src/services/loanService.js` | NUEVO |
| `backend/src/controllers/loanController.js` | NUEVO |
| `backend/src/routes/loans.js` | NUEVO |
| `backend/src/routes/index.js` | Registrar `/loans` |
| `backend/src/middleware/validation.js` | + `loanCreateSchema` + `loanPaymentSchema` |
| `frontend/src/pages/treasury/LoansPage.jsx` | NUEVO |
| `frontend/src/components/treasury/NewLoanModal.jsx` | NUEVO |
| `frontend/src/components/treasury/LoanPaymentModal.jsx` | NUEVO |
| `frontend/src/components/treasury/index.js` | + exports |
| `frontend/src/lib/treasuryApi.js` | + `loansApi` con `getAll, getOne, create, addPayment, cancel` |
| `frontend/src/App.jsx` | + Route `/treasury/loans` |
| `frontend/src/components/layout/AppLayout.jsx` | + link "Préstamos" en sidebar |
| `tests/e2e/treasury/loans.spec.ts` | NUEVO |
| `tests/helpers/api.ts` | + helpers `apiCreateLoan`, `apiListLoans`, `apiAddLoanPayment` |
| `frontend/src/components/shared/ThirdPartySelector.jsx` | + opción `EMPLOYEE` en el `<select>` de tipo (con label "Empleado") + en `TYPE_LABELS` y `TYPE_COLORS` |
| `tests/global-setup.ts` | + 1 third_party tipo `EMPLOYEE` ('Empleado Test') con id `test-tp-employee` para los tests E2E de préstamos |
| `tests/helpers/db.ts` | reflejar el nuevo seed en `seedAccountsAndParties` |
