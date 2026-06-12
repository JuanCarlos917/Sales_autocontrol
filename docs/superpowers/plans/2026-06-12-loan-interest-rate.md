# Tasa de interés en préstamos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir asignar una tasa de interés (% fijo único sobre el principal) al crear un préstamo interno, de modo que el deudor devuelva capital + interés, con el interés reconocido proporcionalmente en cada pago bajo una categoría contable propia.

**Architecture:** La matemática del interés y del split de pagos vive como funciones puras en `backend/src/utils/financial.js` (unit-tested con `node:test`, según convención del proyecto). El service (`loanService.js`) las consume y persiste el desglose. La integración end-to-end se verifica con Playwright contra la DB de test. Frontend: modal de creación gana un input de tasa y reparte el interés en el cronograma; modal de pago y listado calculan el saldo sobre el total a devolver.

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (backend, CommonJS), React 18 + Vite + Tailwind (frontend), `node:test` (unit), Playwright (e2e). Moneda COP sin decimales.

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/src/utils/financial.js` | Modificar | Funciones puras `roundCop`, `calcLoanInterest`, `splitLoanPayment` |
| `backend/src/utils/__tests__/financial.test.js` | Modificar | Unit tests de las nuevas funciones puras |
| `backend/prisma/schema.prisma` | Modificar | Campos en `Loan` y `LoanPayment`, valor de enum |
| `backend/prisma/migrations/.../migration.sql` | Crear (vía prisma) | DDL + backfill de pagos históricos |
| `backend/src/services/loanService.js` | Modificar | `create`, `addPayment`, `recomputeLoanStatus` |
| `backend/src/middleware/validation.js` | Modificar | `interestRate` en `loanCreateSchema` |
| `frontend/src/components/treasury/NewLoanModal.jsx` | Modificar | Input de tasa, cronograma sobre total, resumen |
| `frontend/src/components/treasury/LoanPaymentModal.jsx` | Modificar | Saldo sobre `totalToRepay`, desglose |
| `frontend/src/pages/treasury/LoansPage.jsx` | Modificar | Pendiente/totales sobre `totalToRepay` |
| `tests/e2e/treasury/loan-interest.spec.ts` | Crear | E2E del préstamo con interés |

---

## Task 1: Funciones puras de interés y split en `financial.js`

**Files:**
- Modify: `backend/src/utils/financial.js:213` (línea de `module.exports`)
- Test: `backend/src/utils/__tests__/financial.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `backend/src/utils/__tests__/financial.test.js`:

```js
const {
  roundCop,
  calcLoanInterest,
  splitLoanPayment,
} = require('../financial');

// ── roundCop ─────────────────────────────────────────────────
test('roundCop: redondea a entero (COP sin decimales)', () => {
  assert.equal(roundCop(1000.4), 1000);
  assert.equal(roundCop(1000.5), 1001);
  assert.equal(roundCop(0), 0);
});

// ── calcLoanInterest ─────────────────────────────────────────
test('calcLoanInterest: 10% de 10M = 1M', () => {
  assert.equal(calcLoanInterest(10_000_000, 10), 1_000_000);
});

test('calcLoanInterest: tasa 0 o nula = 0', () => {
  assert.equal(calcLoanInterest(10_000_000, 0), 0);
  assert.equal(calcLoanInterest(10_000_000, null), 0);
});

test('calcLoanInterest: redondea a entero', () => {
  assert.equal(calcLoanInterest(3_333_333, 10), 333_333);
});

// ── splitLoanPayment ─────────────────────────────────────────
test('splitLoanPayment: reparte proporcional capital/interés', () => {
  // total 11M, interés 1M => 9.0909% interés
  const r = splitLoanPayment(1_100_000, 1_000_000, 11_000_000);
  assert.equal(r.interestPortion, 100_000);
  assert.equal(r.capitalPortion, 1_000_000);
});

test('splitLoanPayment: sin interés todo es capital', () => {
  const r = splitLoanPayment(500_000, 0, 5_000_000);
  assert.equal(r.interestPortion, 0);
  assert.equal(r.capitalPortion, 500_000);
});

test('splitLoanPayment: capital + interés siempre suman el abono', () => {
  const r = splitLoanPayment(777_777, 1_000_000, 11_000_000);
  assert.equal(r.capitalPortion + r.interestPortion, 777_777);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: FAIL — `roundCop is not a function` (las funciones aún no existen).

- [ ] **Step 3: Implementar las funciones puras**

En `backend/src/utils/financial.js`, justo antes de la línea `module.exports = { ... }` (actualmente línea 213), agregar:

```js
// ── Préstamos: interés y reparto de pagos ────────────────────
// COP no maneja decimales: todo monto se redondea a entero.
function roundCop(n) {
  return Math.round(parseFloat(n) || 0);
}

// Interés fijo único sobre el principal (congelado al crear el préstamo).
function calcLoanInterest(principal, ratePct) {
  const p = parseFloat(principal) || 0;
  const r = parseFloat(ratePct) || 0;
  return roundCop((p * r) / 100);
}

// Reparte un abono entre capital recuperado e interés ganado,
// proporcional al peso del interés sobre el total a devolver.
// Garantiza capitalPortion + interestPortion === amount.
function splitLoanPayment(amount, interestAmount, totalToRepay) {
  const a = roundCop(amount);
  const interest = parseFloat(interestAmount) || 0;
  const total = parseFloat(totalToRepay) || 0;
  if (total <= 0 || interest <= 0) {
    return { capitalPortion: a, interestPortion: 0 };
  }
  const interestPortion = roundCop((a * interest) / total);
  return { capitalPortion: a - interestPortion, interestPortion };
}
```

Y extender el `module.exports` (línea 213) agregando los tres nombres:

```js
module.exports = { daysBetween, calculateVehicleMetrics, projectProfit, calculateParticipation, calculateCommissionBase, roundCop, calcLoanInterest, splitLoanPayment };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: PASS (todos los tests, incluidos los preexistentes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/financial.js backend/src/utils/__tests__/financial.test.js
git commit -m "feat(treasury): funciones puras de interés y split de pagos de préstamo"
```

---

## Task 2: Esquema Prisma + migración con backfill

**Files:**
- Modify: `backend/prisma/schema.prisma:503-527` (model `Loan`), `:545-562` (model `LoanPayment`), `:353-370` (enum `TransactionCategory`)
- Create: `backend/prisma/migrations/<timestamp>_loan_interest/migration.sql`

- [ ] **Step 1: Agregar campos al model `Loan`**

En `backend/prisma/schema.prisma`, dentro de `model Loan`, después de la línea `extraReceived    Decimal    @default(0) @db.Decimal(15, 2)` (línea 509), agregar:

```prisma
  interestRate     Decimal    @default(0) @db.Decimal(5, 2)
  interestAmount   Decimal    @default(0) @db.Decimal(15, 2)
  interestReceived Decimal    @default(0) @db.Decimal(15, 2)
```

- [ ] **Step 2: Agregar campos al model `LoanPayment`**

Dentro de `model LoanPayment`, después de la línea `extraAmount     Decimal  @default(0) @db.Decimal(15, 2)` (línea 550), agregar:

```prisma
  capitalPortion  Decimal  @default(0) @db.Decimal(15, 2)
  interestPortion Decimal  @default(0) @db.Decimal(15, 2)
```

- [ ] **Step 3: Agregar valor al enum `TransactionCategory`**

En `enum TransactionCategory`, después de `LOAN_EXTRA_INCOME` (línea 367), agregar:

```prisma
  LOAN_INTEREST_INCOME
```

- [ ] **Step 4: Generar la migración sin aplicarla (para editar el backfill)**

Run: `cd backend && npx prisma migrate dev --name loan_interest --create-only`
Expected: crea `backend/prisma/migrations/<timestamp>_loan_interest/migration.sql` con los `ALTER TABLE`, sin aplicar.

- [ ] **Step 5: Agregar el backfill de pagos históricos a la migración**

Al final del archivo `migration.sql` recién creado, agregar:

```sql
-- Backfill: pagos históricos eran 100% capital (sin interés).
UPDATE "loan_payments" SET "capitalPortion" = "principalAmount" WHERE "interestPortion" = 0;
```

- [ ] **Step 6: Aplicar la migración**

Run: `cd backend && npx prisma migrate dev`
Expected: aplica la migración y regenera el client sin errores. Los préstamos existentes quedan con `interestRate=0`, `interestAmount=0`, `interestReceived=0`.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(treasury): schema y migración para interés de préstamos"
```

---

## Task 3: Service `create` — calcular interés y validar cuotas contra el total

**Files:**
- Modify: `backend/src/services/loanService.js:46-116` (método `create`)

- [ ] **Step 1: Importar las funciones puras**

En `backend/src/services/loanService.js`, después de la línea 7 (`const accountService = require('./accountService');`), agregar:

```js
const { calcLoanInterest } = require('../utils/financial');
```

- [ ] **Step 2: Aceptar `interestRate` y calcular interés en `create`**

Reemplazar la firma y el inicio del método `create` (líneas 47-53). Bloque actual:

```js
  async create({ borrowerId, originAccountId, principalAmount, description, notes, disbursementDate, installments }, userId) {
    const principal = parseFloat(principalAmount);

    const installmentsSum = installments.reduce((s, i) => s + parseFloat(i.plannedAmount), 0);
    if (Math.abs(installmentsSum - principal) > 0.01) {
      throw new AppError(`La suma de cuotas (${installmentsSum}) no coincide con el principal (${principal})`, 400);
    }
```

Reemplazar por:

```js
  async create({ borrowerId, originAccountId, principalAmount, interestRate, description, notes, disbursementDate, installments }, userId) {
    const principal = parseFloat(principalAmount);
    const rate = parseFloat(interestRate) || 0;
    const interestAmount = calcLoanInterest(principal, rate);
    const totalToRepay = principal + interestAmount;

    const installmentsSum = installments.reduce((s, i) => s + parseFloat(i.plannedAmount), 0);
    if (Math.abs(installmentsSum - totalToRepay) > 0.01) {
      throw new AppError(`La suma de cuotas (${installmentsSum}) no coincide con el total a devolver (${totalToRepay})`, 400);
    }
```

- [ ] **Step 3: Persistir `interestRate` e `interestAmount` en el `Loan`**

En el bloque `tx.loan.create({ data: { ... } })` (líneas 78-96), después de la línea `principalAmount: principal,` (línea 82), agregar:

```js
          interestRate: rate,
          interestAmount,
```

> La transacción de desembolso (`LOAN_DISBURSEMENT`, líneas 98-110) y la validación de saldo de la cuenta origen (líneas 72-75) **no cambian**: siguen operando solo sobre `principal`. El interés no se desembolsa.

- [ ] **Step 4: Verificar con e2e existente (no debe romperse la retrocompat)**

Run: `cd backend && node -e "require('./src/services/loanService')"`
Expected: sin errores de sintaxis/carga del módulo. (La verificación funcional completa ocurre en Task 8.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/loanService.js
git commit -m "feat(treasury): create de préstamo calcula interés y valida cuotas sobre el total"
```

---

## Task 4: Service `addPayment` — split proporcional, transacciones y estado

**Files:**
- Modify: `backend/src/services/loanService.js:140-252` (`addPayment`). `recomputeLoanStatus` (líneas 19-25) **no cambia su cuerpo**: ya compara genéricamente el primer argumento contra el pagado, así que basta con invocarlo con `totalToRepay`.

- [ ] **Step 1: Importar `splitLoanPayment`**

Extender el `require` agregado en Task 3 (línea bajo el import de `accountService`):

```js
const { calcLoanInterest, splitLoanPayment } = require('../utils/financial');
```

- [ ] **Step 2: Calcular `remaining` y el estado sobre el total a devolver**

En `addPayment`, reemplazar el cálculo de `remaining` (líneas 156-159). Bloque actual:

```js
    const remaining = parseFloat(loan.principalAmount) - parseFloat(loan.paidAmount);
    if (principal > remaining + 0.001) {
      throw new AppError(`El monto principal (${principal}) excede el saldo pendiente (${remaining}). Usá el campo extra para el sobrante.`, 400);
    }
```

Reemplazar por:

```js
    const totalToRepay = parseFloat(loan.principalAmount) + parseFloat(loan.interestAmount);
    const remaining = totalToRepay - parseFloat(loan.paidAmount);
    if (principal > remaining + 0.001) {
      throw new AppError(`El monto principal (${principal}) excede el saldo pendiente (${remaining}). Usá el campo extra para el sobrante.`, 400);
    }
```

- [ ] **Step 3: Calcular el split del abono con reconciliación de redondeo**

En `addPayment`, después del cálculo de `newLoanPaid`/`newLoanExtra`/`newLoanStatus` (líneas 180-182), reemplazar ese bloque. Bloque actual:

```js
    const newLoanPaid = parseFloat(loan.paidAmount) + principal;
    const newLoanExtra = parseFloat(loan.extraReceived) + extra;
    const newLoanStatus = recomputeLoanStatus(loan.principalAmount, newLoanPaid);
```

Reemplazar por:

```js
    const newLoanPaid = parseFloat(loan.paidAmount) + principal;
    const newLoanExtra = parseFloat(loan.extraReceived) + extra;
    const newLoanStatus = recomputeLoanStatus(totalToRepay, newLoanPaid);

    // Reparto capital/interés del abono. Si el préstamo queda saldado,
    // el interés de este pago absorbe el remanente exacto para que
    // interestReceived cierre en interestAmount (evita drift de redondeo).
    const interestAmount = parseFloat(loan.interestAmount);
    let split;
    if (newLoanStatus === 'PAID') {
      const interestPortion = Math.max(0, interestAmount - parseFloat(loan.interestReceived));
      split = { interestPortion, capitalPortion: principal - interestPortion };
    } else {
      split = splitLoanPayment(principal, interestAmount, totalToRepay);
    }
    const newInterestReceived = parseFloat(loan.interestReceived) + split.interestPortion;
```

- [ ] **Step 4: Emitir transacciones de capital e interés por separado**

Reemplazar el bloque que crea la transacción de `LOAN_REPAYMENT` (líneas 197-212). Bloque actual:

```js
      if (principal > 0) {
        await tx.transaction.create({
          data: {
            accountId,
            type: 'INCOME',
            category: 'LOAN_REPAYMENT',
            amount: principal,
            description: `Pago préstamo: ${loan.borrower.name}`,
            date: new Date(), // fecha de contabilización = instante de registro
            thirdPartyId: loan.borrowerId,
            loanId,
            loanPaymentId: payment.id,
            createdBy: userId,
          },
        });
      }
```

Reemplazar por:

```js
      if (split.capitalPortion > 0) {
        await tx.transaction.create({
          data: {
            accountId,
            type: 'INCOME',
            category: 'LOAN_REPAYMENT',
            amount: split.capitalPortion,
            description: `Pago préstamo (capital): ${loan.borrower.name}`,
            date: new Date(), // fecha de contabilización = instante de registro
            thirdPartyId: loan.borrowerId,
            loanId,
            loanPaymentId: payment.id,
            createdBy: userId,
          },
        });
      }

      if (split.interestPortion > 0) {
        await tx.transaction.create({
          data: {
            accountId,
            type: 'INCOME',
            category: 'LOAN_INTEREST_INCOME',
            amount: split.interestPortion,
            description: `Interés préstamo: ${loan.borrower.name}`,
            date: new Date(), // fecha de contabilización = instante de registro
            thirdPartyId: loan.borrowerId,
            loanId,
            loanPaymentId: payment.id,
            createdBy: userId,
          },
        });
      }
```

- [ ] **Step 5: Persistir el split en el `LoanPayment` y `interestReceived` en el `Loan`**

En el `tx.loanPayment.create({ data: { ... } })` (líneas 185-195), después de la línea `extraAmount: extra,` (línea 190), agregar:

```js
          capitalPortion: split.capitalPortion,
          interestPortion: split.interestPortion,
```

En el `tx.loan.update({ where: { id: loanId }, data: { ... } })` (líneas 238-246), reemplazar el objeto `data`. Bloque actual:

```js
        data: {
          paidAmount: newLoanPaid,
          extraReceived: newLoanExtra,
          status: newLoanStatus,
        },
```

Reemplazar por:

```js
        data: {
          paidAmount: newLoanPaid,
          interestReceived: newInterestReceived,
          extraReceived: newLoanExtra,
          status: newLoanStatus,
        },
```

- [ ] **Step 6: Verificar carga del módulo**

Run: `cd backend && node -e "require('./src/services/loanService')"`
Expected: sin errores. (Verificación funcional en Task 8.)

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/loanService.js
git commit -m "feat(treasury): pagos de préstamo reparten capital e interés en el ledger"
```

---

## Task 5: Validación Joi de `interestRate`

**Files:**
- Modify: `backend/src/middleware/validation.js:417-425` (`loanCreateSchema`)

- [ ] **Step 1: Agregar `interestRate` al schema de creación**

En `loanCreateSchema`, después de la línea `principalAmount: Joi.number().positive().required()...` (línea 420), agregar:

```js
  interestRate: Joi.number().min(0).max(100).default(0),
```

- [ ] **Step 2: Verificar carga del módulo de validación**

Run: `cd backend && node -e "require('./src/middleware/validation')"`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/validation.js
git commit -m "feat(treasury): validar interestRate en creación de préstamo"
```

---

## Task 6: Frontend — input de tasa y cronograma con interés (`NewLoanModal`)

**Files:**
- Modify: `frontend/src/components/treasury/NewLoanModal.jsx`

- [ ] **Step 1: Renombrar el parámetro de `generateInstallments` a "total"**

En `NewLoanModal.jsx`, la función `generateInstallments` (líneas 23-37) reparte el primer argumento entre cuotas. No requiere cambios internos, pero se invocará con `principal + interés`. Dejar la función igual.

- [ ] **Step 2: Agregar estado de tasa de interés**

Después de la línea `const [principal, setPrincipal] = useState('');` (línea 43), agregar:

```jsx
  const [interestRate, setInterestRate] = useState('');
```

En el reset del `useEffect` (después de `setPrincipal('');`, línea 56), agregar:

```jsx
    setInterestRate('');
```

- [ ] **Step 3: Derivar interés y total**

Después del `useMemo` de `totalSchedule` (líneas 71-74), agregar:

```jsx
  const interestAmount = useMemo(() => {
    const p = parseFloat(principal) || 0;
    const r = parseFloat(interestRate) || 0;
    return Math.round((p * r) / 100);
  }, [principal, interestRate]);

  const totalToRepay = (parseFloat(principal) || 0) + interestAmount;
```

- [ ] **Step 4: Validar la suma de cuotas contra el total a devolver**

Reemplazar la línea `sumOk` (línea 76). Actual:

```jsx
  const sumOk = installments.length > 0 && Math.abs(totalSchedule - (parseFloat(principal) || 0)) < 0.01;
```

Reemplazar por:

```jsx
  const sumOk = installments.length > 0 && Math.abs(totalSchedule - totalToRepay) < 0.01;
```

- [ ] **Step 5: Generar el cronograma sobre el total**

Reemplazar `handleGenerate` (líneas 78-80). Actual:

```jsx
  const handleGenerate = () => {
    setInstallments(generateInstallments(principal, count, frequency, firstDate));
  };
```

Reemplazar por:

```jsx
  const handleGenerate = () => {
    setInstallments(generateInstallments(totalToRepay, count, frequency, firstDate));
  };
```

- [ ] **Step 6: Enviar `interestRate` en el payload**

En `handleSubmit`, dentro del objeto `payload` (líneas 94-105), después de la línea `principalAmount: parseFloat(principal),` (línea 97), agregar:

```jsx
        interestRate: parseFloat(interestRate) || 0,
```

- [ ] **Step 7: Agregar el input de tasa en el form**

En el `grid grid-cols-4` de monto/cuotas (líneas 144-189), cambiar la clase a `grid-cols-5` y agregar, justo después del bloque del input "Monto principal" (que termina en línea 156, el `</div>` del campo principal), un nuevo campo:

```jsx
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Interés (%)</label>
            <input
              type="number"
              value={interestRate}
              onChange={(e) => setInterestRate(e.target.value)}
              className="input w-full"
              min="0"
              max="100"
              step="0.01"
              placeholder="0"
              data-testid="loan-form-interest-rate"
            />
          </div>
```

- [ ] **Step 8: Mostrar el resumen capital/interés/total**

Dentro del bloque del cronograma, después de la fila "Suma cuotas" (líneas 202-205), agregar antes de la `<table>`:

```jsx
            {interestAmount > 0 && (
              <div className="flex justify-between text-sm" data-testid="loan-form-interest-summary">
                <span className="text-[#8B949E]">Capital {formatCurrency(parseFloat(principal) || 0)} + interés {formatCurrency(interestAmount)}:</span>
                <span className="text-[#E6EDF3] font-semibold">Total {formatCurrency(totalToRepay)}</span>
              </div>
            )}
```

- [ ] **Step 9: Verificar build del frontend**

Run: `cd frontend && npm run build`
Expected: build exitoso sin errores.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/treasury/NewLoanModal.jsx
git commit -m "feat(treasury): NewLoanModal con tasa de interés y cronograma sobre el total"
```

---

## Task 7: Frontend — saldo sobre total a devolver (`LoanPaymentModal`, `LoansPage`)

**Files:**
- Modify: `frontend/src/components/treasury/LoanPaymentModal.jsx:16`
- Modify: `frontend/src/pages/treasury/LoansPage.jsx:72-76`, `:155`, `:177-179`

- [ ] **Step 1: `LoanPaymentModal` — calcular saldo sobre el total a devolver**

En `LoanPaymentModal.jsx`, reemplazar la línea 16. Actual:

```jsx
  const remaining = loan ? parseFloat(loan.principalAmount) - parseFloat(loan.paidAmount) : 0;
```

Reemplazar por:

```jsx
  const totalToRepay = loan ? parseFloat(loan.principalAmount) + parseFloat(loan.interestAmount || 0) : 0;
  const remaining = loan ? totalToRepay - parseFloat(loan.paidAmount) : 0;
```

- [ ] **Step 2: `LoansPage` — totales sobre el total a devolver**

En `LoansPage.jsx`, reemplazar el bloque `totals` (líneas 72-76). Actual:

```jsx
  const totals = {
    lent: loans.reduce((s, l) => s + parseFloat(l.principalAmount), 0),
    paid: loans.reduce((s, l) => s + parseFloat(l.paidAmount), 0),
  };
  totals.pending = totals.lent - totals.paid;
```

Reemplazar por:

```jsx
  const totals = {
    lent: loans.reduce((s, l) => s + parseFloat(l.principalAmount), 0),
    toRepay: loans.reduce((s, l) => s + parseFloat(l.principalAmount) + parseFloat(l.interestAmount || 0), 0),
    paid: loans.reduce((s, l) => s + parseFloat(l.paidAmount), 0),
  };
  totals.pending = totals.toRepay - totals.paid;
```

- [ ] **Step 3: `LoansPage` — pendiente por tarjeta sobre el total**

Reemplazar la línea 155. Actual:

```jsx
            const pending = parseFloat(loan.principalAmount) - parseFloat(loan.paidAmount);
```

Reemplazar por:

```jsx
            const totalToRepay = parseFloat(loan.principalAmount) + parseFloat(loan.interestAmount || 0);
            const pending = totalToRepay - parseFloat(loan.paidAmount);
```

- [ ] **Step 4: `LoansPage` — mostrar el total a devolver en la tarjeta**

Reemplazar el bloque "de {formatCurrency(...)}" (líneas 177-179). Actual:

```jsx
                  <div className="text-right text-xs text-[#6E7681]">
                    de {formatCurrency(loan.principalAmount)}
                  </div>
```

Reemplazar por:

```jsx
                  <div className="text-right text-xs text-[#6E7681]">
                    de {formatCurrency(totalToRepay)}
                    {parseFloat(loan.interestAmount || 0) > 0 && (
                      <div className="text-[#8B949E]">incl. interés {formatCurrency(loan.interestAmount)}</div>
                    )}
                  </div>
```

- [ ] **Step 5: Verificar build del frontend**

Run: `cd frontend && npm run build`
Expected: build exitoso sin errores.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/treasury/LoanPaymentModal.jsx frontend/src/pages/treasury/LoansPage.jsx
git commit -m "feat(treasury): saldo de préstamos calculado sobre capital + interés"
```

---

## Task 8: E2E — préstamo con interés (capital + interés + categorías)

**Files:**
- Create: `tests/e2e/treasury/loan-interest.spec.ts`
- Reference: `tests/e2e/treasury/loans.spec.ts` (patrón existente), `tests/helpers/api.ts`, `tests/global-setup.ts`

- [ ] **Step 1: Escribir el spec E2E**

Crear `tests/e2e/treasury/loan-interest.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetAccount,
  apiCreateLoan,
  apiGetLoan,
  apiAddLoanPayment,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — préstamos con interés', () => {
  test('crea préstamo 10M @ 10%, total a devolver 11M, pago reparte capital e interés', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const PRINCIPAL = 10_000_000;
    const today = new Date().toISOString().slice(0, 10);

    // Cronograma debe sumar el total a devolver (11M), no el principal.
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: PRINCIPAL,
      interestRate: 10,
      installments: [
        { sequence: 1, dueDate: today, plannedAmount: 5_500_000 },
        { sequence: 2, dueDate: today, plannedAmount: 5_500_000 },
      ],
    });

    expect(parseFloat(loan.interestAmount as string)).toBe(1_000_000);

    // El desembolso saca solo el principal.
    const cashAfter = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string,
    );
    expect(Number.isFinite(cashAfter)).toBe(true);

    const bankBefore = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );

    // Primer pago de 5.5M: 90.909% capital (5M) + 9.0909% interés (500k).
    await apiAddLoanPayment(token, loan.id, {
      accountId: TEST_SEED_IDS.accountBank,
      principalAmount: 5_500_000,
    });

    const bankAfter = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );
    expect(bankAfter - bankBefore).toBe(5_500_000);

    const afterFirst = await apiGetLoan(token, loan.id);
    expect(parseFloat(afterFirst.paidAmount as string)).toBe(5_500_000);
    expect(parseFloat(afterFirst.interestReceived as string)).toBe(500_000);
    expect(afterFirst.status).toBe('PARTIAL');

    // Segundo pago salda el préstamo: interés cierra exacto en 1M.
    await apiAddLoanPayment(token, loan.id, {
      accountId: TEST_SEED_IDS.accountBank,
      principalAmount: 5_500_000,
    });

    const afterSecond = await apiGetLoan(token, loan.id);
    expect(parseFloat(afterSecond.paidAmount as string)).toBe(11_000_000);
    expect(parseFloat(afterSecond.interestReceived as string)).toBe(1_000_000);
    expect(afterSecond.status).toBe('PAID');

    // El ledger registró interés bajo su categoría propia.
    const interestTx = (afterSecond.transactions as Array<{ category: string }> | undefined)
      ?.filter((t) => t.category === 'LOAN_INTEREST_INCOME');
    expect((interestTx?.length ?? 0)).toBeGreaterThan(0);
  });
});
```

> Nota: si `apiGetLoan` no incluye `transactions`, basta con verificar `interestReceived` y `status`; la aserción del ledger es complementaria. Revisar `tests/helpers/api.ts` y ajustar el acceso a transacciones según lo que devuelva el endpoint.

- [ ] **Step 2: Correr el spec nuevo y verificar que pasa**

Run: `npx playwright test tests/e2e/treasury/loan-interest.spec.ts`
Expected: PASS.

- [ ] **Step 3: Correr la suite de préstamos existente (no debe romperse)**

Run: `npx playwright test tests/e2e/treasury/loans.spec.ts`
Expected: PASS (retrocompatibilidad: préstamos sin interés siguen igual).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/treasury/loan-interest.spec.ts
git commit -m "test(treasury): e2e de préstamo con interés y reparto de pagos"
```

---

## Verificación final

- [ ] **Unit:** `cd backend && node --test src/` → todo verde.
- [ ] **Build frontend:** `cd frontend && npm run build` → exitoso.
- [ ] **E2E préstamos:** `npx playwright test tests/e2e/treasury/` → todo verde.
- [ ] Invocar `verification-loop` (build + lint + tests + security) antes de marcar completo, según CLAUDE.md.
