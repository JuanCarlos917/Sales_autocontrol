# Spec: Créditos / financiaciones del negocio (deudas con cuotas)

- **Fecha:** 2026-06-13
- **Estado:** Aprobado (diseño)
- **Módulo:** Tesorería → Créditos (deudas que el negocio paga en cuotas)
- **Código:** entidad `Debt` (UI: "Créditos")

## Problema

El negocio tiene un crédito/financiación activo que paga en cuotas mensuales. Hoy
cada cuota se registra como un `Expense` genérico (con una categoría de gasto y
"pago cuota" en la descripción). Esto **no es auditable ni trazable**: no hay saldo
de la deuda, no se sabe cuánto falta, y como `Expense` exige un `vehicleId`, los
pagos quedan colgados de un vehículo e **inflan su costo**.

Se necesita modelar la deuda como un **pasivo propio** con cronograma de cuotas,
donde cada pago salga de una cuenta y quede auditado contra el saldo de la deuda.
Es el **espejo del feature de Préstamos** (`Loan`), pero del lado del pasivo.

## Decisiones de diseño (confirmadas)

| Decisión | Resolución |
|---|---|
| Origen del crédito | **Financió un activo, no pasó por cuentas** → sin movimiento de tesorería al crear |
| Composición de la cuota | **Monto total** (sin desglose capital/interés) |
| Total a pagar | **= suma de las cuotas** del cronograma |
| Alcance | Un crédito activo hoy, pero el modelo soporta varios; cada uno con cronograma |
| Vínculo | **Obligación del negocio (standalone)** — los pagos NO se cargan a un vehículo |
| Migración de pagos históricos | **Reconciliación por enlace** (no se toca la plata ya movida) |
| Egreso histórico al reconciliar | **(ii) Enlazar + reclasificar** a `DEBT_PAYMENT`, sacándolo del costo del vehículo (sin tocar el monto, con audit log) |

## Restricciones

- Moneda COP, **sin decimales** (montos enteros).
- **Trazabilidad (política de tesorería vigente):** los movimientos son inmutables en
  su **monto/efecto de caja**. La reconciliación nunca altera montos; solo crea
  enlaces y, en el caso (ii), reclasifica la **categoría** de un movimiento histórico,
  dejando registro en el audit log.
- Backend CommonJS; cálculos centralizados; validación con Joi; idioma UI español,
  código en inglés.

---

## 1. Modelos (Prisma)

### `Debt` (la financiación que el negocio debe)

```prisma
model Debt {
  id               String     @id @default(cuid())
  name             String                                  // ej. "Crédito Hilux"
  lender           String?                                 // acreedor/banco (texto libre)
  assetDescription String?                                 // qué se financió
  totalAmount      Decimal    @db.Decimal(15, 2)           // = suma de cuotas
  paidAmount       Decimal    @default(0) @db.Decimal(15, 2)
  status           DebtStatus @default(PENDING)
  startDate        DateTime   @default(now())              // informativa, sin transacción
  notes            String?
  createdBy        String
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt

  installments DebtInstallment[]
  payments     DebtPayment[]
  transactions Transaction[]

  @@index([status])
  @@map("debts")
}
```

### `DebtInstallment` (cuota)

```prisma
model DebtInstallment {
  id            String            @id @default(cuid())
  debtId        String
  sequence      Int
  dueDate       DateTime
  plannedAmount Decimal           @db.Decimal(15, 2)
  paidAmount    Decimal           @default(0) @db.Decimal(15, 2)
  status        InstallmentStatus @default(PENDING)        // reusa enum existente

  debt Debt @relation(fields: [debtId], references: [id], onDelete: Cascade)

  @@unique([debtId, sequence])
  @@index([dueDate])
  @@map("debt_installments")
}
```

### `DebtPayment` (pago de cuota)

```prisma
model DebtPayment {
  id        String   @id @default(cuid())
  debtId    String
  accountId String
  amount    Decimal  @db.Decimal(15, 2)
  date      DateTime @default(now())
  notes     String?
  createdBy String
  createdAt DateTime @default(now())

  debt         Debt          @relation(fields: [debtId], references: [id], onDelete: Cascade)
  account      Account       @relation("DebtPaymentAccount", fields: [accountId], references: [id])
  transactions Transaction[]

  @@index([debtId])
  @@map("debt_payments")
}
```

### `Transaction` — FKs nuevas (igual que hoy con préstamos)

```prisma
debtId        String?
debt          Debt?        @relation(fields: [debtId], references: [id])
debtPaymentId String?
debtPayment   DebtPayment? @relation(fields: [debtPaymentId], references: [id])
```
(más `@@index([debtId])`, `@@index([debtPaymentId])`)

### Enums

- Nuevo `enum DebtStatus { PENDING PARTIAL PAID CANCELLED }` (espejo de `LoanStatus`).
- `TransactionCategory`: agregar `DEBT_PAYMENT`.
- `TreasuryAuditEntity`: agregar `DEBT`.

---

## 2. Backend — servicio (`debtService.js`)

### `create({ name, lender, assetDescription, startDate, notes, installments }, userId)`
- `totalAmount = suma(plannedAmount)`; valida secuencias 1..N sin huecos.
- **No** crea ninguna `Transaction` (el activo no pasó por las cuentas).
- Audit log `DEBT` / CREATE.

### `addPayment(debtId, { accountId, amount, date, notes }, userId)`
- Valida `amount > 0`, `amount ≤ remaining` (`totalAmount − paidAmount`), y **saldo
  suficiente** en la cuenta (es egreso).
- Crea `DebtPayment` + `Transaction` tipo `EXPENSE`, categoría `DEBT_PAYMENT`, con
  `debtId`/`debtPaymentId`, `accountId`, **sin `vehicleId`**.
- Imputa el abono a las cuotas pendientes FIFO (reduce `plannedAmount − paidAmount`).
- Actualiza `debt.paidAmount`, `status` (`PAID` cuando `paidAmount ≥ totalAmount`).
- Audit log `DEBT` / PAYMENT.

### `reconcile(debtId, { transactionIds }, userId)` — migración de históricos
La transacción histórica **ya debitó la cuenta**; esa es la huella de caja inmutable y
se conserva. La reconciliación **nunca genera una reversa ni un nuevo movimiento de
caja** y **nunca altera el monto**. Para cada `transactionId` (egreso existente que era
una cuota), dentro de una transacción de DB:
  - Crea un `DebtPayment` enlazado a la `Transaction` existente (sin caja nueva).
  - **(ii) Reclasifica la `Transaction`:** setea `debtId`/`debtPaymentId`, cambia
    `category` → `DEBT_PAYMENT`, y limpia `vehicleId = null` y `expenseId = null`
    (la saca del rollup de gastos del vehículo). El monto queda intacto.
  - Si la transacción venía de un `Expense`, ese `Expense` se **soft-deletea**
    (`deletedAt`/`deletedBy`) — **sin** pasar por el flujo de borrado que reversa caja —
    para que deje de contar en el P&L del vehículo. La huella de caja persiste vía la
    `Transaction` ya reclasificada.
  - Imputa a la(s) cuota(s) FIFO y sube `paidAmount`/`status`.
- Audit log `DEBT` / RECONCILE por cada enlace (referencia la transacción original).
- Valida que el `transactionId` sea EXPENSE, no esté ya enlazado a otra deuda, y que la
  suma reconciliada no exceda `totalAmount`.

### `list` / `findById` / `cancel`
- `cancel` solo si `status === PENDING` (sin pagos), espejo de `Loan.cancel`.

---

## 3. Backend — validación (`validation.js`)

- `debtCreateSchema`: `name` requerido; `lender`/`assetDescription`/`notes` opcionales;
  `installments` array (`sequence`, `dueDate`, `plannedAmount` entero positivo) min 1.
- `debtPaymentSchema`: `accountId` requerido, `amount` entero positivo, `date`/`notes`.
- `debtReconcileSchema`: `transactionIds` array de strings, min 1.

---

## 4. Backend — endpoints (`routes/debts.js`, `debtController.js`)

- `POST /debts` · `GET /debts` · `GET /debts/:id` · `POST /debts/:id/payments`
- `POST /debts/:id/reconcile` · `POST /debts/:id/cancel`
- `GET /debts/:id/reconcile-candidates` — egresos históricos sugeridos para enlazar
  (transacciones EXPENSE no ya enlazadas a una deuda; filtrables por cuenta/texto).
- Mismas convenciones de paginación/errores/status que el resto del API.

---

## 5. Frontend (bajo `/treasury`)

- **`DebtsPage`** ("Créditos") — espejo de `LoansPage`: cards con saldo pendiente,
  total, próxima cuota, estado; totales arriba (debido / pagado / pendiente).
- **`NewDebtModal`** — acreedor, activo financiado, generador de cronograma (igual que
  `NewLoanModal`, sin campo de interés).
- **`DebtPaymentModal`** — cuenta origen, monto, fecha.
- **`DebtReconcileModal`** — lista de egresos candidatos; seleccionás cuáles enlazar.
- Link desde el landing de Tesorería. La UI se enfoca en el crédito activo aunque el
  modelo soporte varios.

---

## 6. Estrategia de pruebas (TDD)

### Unit (`debtService` / helpers puros)
- Crear: `totalAmount === suma(cuotas)`; rechaza secuencias con huecos.
- Pago: imputa FIFO, baja saldo, `PAID` solo al cubrir el total; rechaza si excede saldo
  pendiente o si la cuenta no tiene fondos.
- Reconciliación: enlaza N transacciones, sube `paidAmount` sin crear caja nueva,
  reclasifica categoría a `DEBT_PAYMENT` y saca del vehículo; rechaza exceso sobre total.

### Integración / E2E (Playwright)
- Crear crédito 12 cuotas, verificar `totalAmount` y cronograma.
- Pagar una cuota → verifica `Transaction` `DEBT_PAYMENT` **sin vehículo**, débito de la
  cuenta, y saldo de la deuda.
- Reconciliar un gasto histórico → el saldo baja, la transacción queda enlazada y
  reclasificada, sin nuevo movimiento de caja.

**Cobertura objetivo:** ≥ 80%.

---

## Fuera de alcance (YAGNI)

- Desglose capital/interés de la cuota (se eligió "monto total"). Si más adelante se
  requiere, se agrega como en `Loan` (`splitLoanPayment`) con categoría de gasto
  financiero separada.
- Ingreso a una cuenta al originar (este crédito financió un activo directamente).
- Tasas, refinanciación, mora/penalidades.
- Multi-moneda.
