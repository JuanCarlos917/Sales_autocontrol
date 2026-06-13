# Spec: Tasa de interés en préstamos (`/treasury/loans`)

- **Fecha:** 2026-06-12
- **Estado:** Aprobado (diseño)
- **Módulo:** Tesorería → Préstamos internos

## Problema

Hoy un préstamo solo registra el capital (`principalAmount`) y el deudor devuelve
exactamente lo prestado. No existe forma de cobrar interés. Se necesita poder
asignar una **tasa de interés** al crear el préstamo, de modo que el deudor deba
devolver el capital **más** el interés.

**Ejemplo de referencia:** prestar 10.000.000 COP al 10% → el deudor debe devolver
11.000.000 COP (10.000.000 de capital + 1.000.000 de interés).

## Decisiones de diseño (confirmadas)

| Decisión | Resolución |
|---|---|
| Cálculo del interés | **% fijo único** sobre el principal, congelado al crear |
| Reparto en cuotas | Las cuotas suman **principal + interés**, prorrateado |
| Condición de `PAID` | Solo cuando se recibe **el total** (capital + interés) |
| Reparto de cada pago | **Proporcional** entre capital recuperado e interés ganado |
| Contabilidad del interés | Nueva categoría `LOAN_INTEREST_INCOME` |
| Campo `extra` ad-hoc | Se mantiene tal como está (concepto independiente) |

## Restricciones

- Moneda COP, **sin decimales** → todos los montos se redondean a enteros.
- **Trazabilidad (política de tesorería vigente):** el interés se **congela** al crear
  el préstamo y los pagos generan transacciones **inmutables** con su desglose.
- **Retrocompatibilidad:** préstamos existentes quedan con `interestRate = 0`,
  comportamiento idéntico al actual.
- Backend CommonJS; cálculos financieros centralizados; validación con Joi.

---

## 1. Cambios de esquema (Prisma)

### `Loan` — campos nuevos

```prisma
interestRate     Decimal @default(0) @db.Decimal(5, 2)   // % ingresado (ej 10.00). 0 = sin interés
interestAmount   Decimal @default(0) @db.Decimal(15, 2)  // interés congelado = round(principal * rate/100)
interestReceived Decimal @default(0) @db.Decimal(15, 2)  // interés acumulado reconocido en pagos
```

- **Semántica de `paidAmount`** cambia: total recibido hacia `totalToRepay`
  (capital + interés combinados). En préstamos sin interés es idéntico al actual.
- `extraReceived` se mantiene sin cambios.

### Derivados (calculados en código, NO se guardan)

- `totalToRepay = principalAmount + interestAmount`
- `capitalReceived = paidAmount − interestReceived`
- `remaining = totalToRepay − paidAmount`

### `LoanPayment` — campos nuevos (auditoría del split)

```prisma
capitalPortion  Decimal @default(0) @db.Decimal(15, 2)  // parte del abono imputada a capital
interestPortion Decimal @default(0) @db.Decimal(15, 2)  // parte del abono imputada a interés
```

- `principalAmount` se **reinterpreta** como "abono al cronograma" (capital + interés).
  En préstamos sin interés sigue siendo 100% capital → sin cambio de comportamiento.
  Se documenta el matiz de naming en el código.

### `LoanInstallment` — sin cambios

Su `plannedAmount` ya representa el monto prorrateado de la cuota; ahora incluirá
la porción de interés implícita. No requiere columnas nuevas.

### Enum `TransactionCategory` — agregar valor

```prisma
LOAN_INTEREST_INCOME
```

---

## 2. Migración de datos

Migración Prisma con backfill explícito:

- `loans`: `interestRate = 0`, `interestAmount = 0`, `interestReceived = 0`.
- `loan_payments`: `capitalPortion = principalAmount`, `interestPortion = 0`.

Cero impacto sobre préstamos y pagos existentes (todos quedan "sin interés").

---

## 3. Backend — `loanService.js`

### `create({ ..., interestRate, installments }, userId)`

1. `interestRate = parseFloat(interestRate || 0)` (0 ≤ rate ≤ 100).
2. `interestAmount = round(principal * interestRate / 100)`.
3. `totalToRepay = principal + interestAmount`.
4. **Validación de cuotas:** `sum(plannedAmount) == totalToRepay` (hoy compara contra
   `principal`). Mensaje de error actualizado.
5. Validación de saldo de la cuenta origen sigue exigiendo solo el **principal**
   (el interés no se desembolsa).
6. Persistir `interestRate`, `interestAmount` en el `Loan`.
7. La transacción de desembolso (`LOAN_DISBURSEMENT`) sigue siendo por el **principal**.

### `addPayment(loanId, { accountId, principalAmount, extraAmount, ... }, userId)`

`principalAmount` = abono `S` al cronograma (capital + interés).

1. `remaining = totalToRepay − paidAmount`. Validar `S ≤ remaining + ε`
   (hoy valida contra `principalAmount − paidAmount`).
2. **Split proporcional del abono:**
   - `interestPortion = round(S * interestAmount / totalToRepay)`
   - `capitalPortion = S − interestPortion`
3. Aplicar `S` a las cuotas pendientes (lógica existente de imputación por installment).
4. **Reconciliación de redondeo:** si tras este pago el préstamo queda `PAID`,
   ajustar `interestPortion`/`capitalPortion` de **este** pago para que
   `interestReceived == interestAmount` exacto y `capitalReceived == principalAmount` exacto.
5. Transacciones generadas (inmutables):
   - `LOAN_REPAYMENT` por `capitalPortion` (si > 0)
   - `LOAN_INTEREST_INCOME` por `interestPortion` (si > 0)
   - `LOAN_EXTRA_INCOME` por `extraAmount` (si > 0) — sin cambios
6. Actualizar `Loan`: `paidAmount += S`, `interestReceived += interestPortion`,
   `extraReceived += extra`, recalcular `status`.
7. Persistir `capitalPortion`/`interestPortion` en el `LoanPayment`.

### `recomputeLoanStatus(totalToRepay, paid)`

`PAID` cuando `paid >= totalToRepay`; `PARTIAL` cuando `0 < paid < totalToRepay`;
`PENDING` cuando `paid <= 0`. (Hoy compara contra `principal`.)

### Helper de redondeo

Reutilizar/centralizar el redondeo COP (sin decimales) en `utils/financial.js`.

---

## 4. Backend — validación (`validation.js`)

- `loanCreateSchema`: agregar
  `interestRate: Joi.number().min(0).max(100).default(0)`.
- La validación cruzada "suma de cuotas" se evalúa contra `principal + interés`
  (se mantiene en service/controller donde corresponda para el mensaje específico).
- `loanPaymentSchema`: sin cambios de forma (`principalAmount` ya existe).

---

## 5. Frontend

### `NewLoanModal.jsx`

- Nuevo input **"Tasa de interés (%)"** (opcional, default 0, decimales permitidos).
- `generateInstallments` distribuye `principal + interés` entre las cuotas
  (mismo algoritmo de prorrateo: base + remainder en la última cuota).
- Panel resumen: **Capital** / **Interés (X%)** / **Total a devolver**.
- Payload incluye `interestRate`.
- La validación `sumOk` compara la suma de cuotas contra `totalToRepay`.

### `LoanPaymentModal.jsx`

- `remaining = totalToRepay − paidAmount` (hoy usa `principalAmount − paidAmount`).
- Mostrar desglose del saldo: capital pendiente vs interés pendiente.
- Campo `extra` sin cambios.

### `LoansSummaryCards.jsx` / `LoansPage.jsx`

- Mostrar interés esperado y/o interés ganado (ajuste de display menor).

---

## 6. Estrategia de pruebas (TDD)

### Unit — `loanService`

- Crear préstamo 10M @ 10% → `interestAmount = 1M`, `totalToRepay = 11M`.
- Validación: cuotas deben sumar 11M (rechaza si suman 10M).
- Split proporcional de un pago intermedio (verifica `capitalPortion`/`interestPortion`).
- Reconciliación de redondeo: serie de pagos cierra con `interestReceived == 1M` exacto.
- `PAID` solo cuando `paidAmount >= 11M` (parcial al pagar 10M).
- Retrocompatibilidad: `rate = 0` → comportamiento idéntico al actual.

### Integración — endpoints

- `POST /loans` con `interestRate` → persistencia y cronograma correctos.
- `POST /loans/:id/payments` → genera transacciones `LOAN_REPAYMENT` +
  `LOAN_INTEREST_INCOME` con los montos del split.

### E2E — Playwright

- Crear préstamo 10M @ 10%, verificar cronograma total 11M.
- Registrar pago y verificar en el ledger las categorías `LOAN_REPAYMENT`
  y `LOAN_INTEREST_INCOME`.

**Cobertura objetivo:** ≥ 80%.

---

## Fuera de alcance (YAGNI)

- Tasas periódicas (mensual/anual) o interés compuesto.
- Interés como monto fijo en COP (solo %).
- Edición de la tasa después de crear el préstamo (es inmutable).
- Mora / penalidades por atraso.
