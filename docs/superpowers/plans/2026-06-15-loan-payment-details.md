# Detalles de pagos en cards (préstamos y créditos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una sección colapsable "Detalles" en cada card de préstamo y de crédito que liste los pagos realizados (fecha, valor total, cuenta, observación), solo lectura.

**Architecture:** Componente compartido `PaymentDetails` (toggle + lista) reutilizado en `LoansPage` y `DebtsPage`. Los pagos ya vienen en `loan.payments` / `debt.payments`. Solo frontend; sin backend, sin schema, sin tocar `/treasury/transactions`.

**Tech Stack:** React 18 + Vite + Tailwind; Playwright. Sin migración.

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `frontend/src/components/treasury/PaymentDetails.jsx` | Crear | Toggle colapsable + lista de pagos |
| `frontend/src/pages/treasury/LoansPage.jsx` | Modificar | Render del componente en cada card de préstamo |
| `frontend/src/pages/treasury/DebtsPage.jsx` | Modificar | Render del componente en cada card de crédito |
| `tests/e2e/treasury/payment-details.spec.ts` | Crear | E2E préstamo + crédito |

---

## Task 1: Componente `PaymentDetails`

**Files:**
- Create: `frontend/src/components/treasury/PaymentDetails.jsx`

- [ ] **Step 1: Crear el componente**

Crear `frontend/src/components/treasury/PaymentDetails.jsx`:

```jsx
import { useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/constants';

// Lista colapsable de pagos. `payments`: [{ id, date, amount, accountName, notes }] (ordenada desc).
// `testidPrefix`: prefijo para los data-testid (ej. `loan-card-<id>` / `debt-card-<id>`).
export default function PaymentDetails({ payments = [], testidPrefix }) {
  const [open, setOpen] = useState(false);
  const count = payments.length;

  return (
    <div className="pt-3 mt-3 border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-xs font-semibold text-[#8B949E] hover:text-[#E6EDF3]"
        data-testid={`${testidPrefix}-details-toggle`}
      >
        <span>Detalles ({count})</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2" data-testid={`${testidPrefix}-details`}>
          {count === 0 ? (
            <div className="text-xs text-[#6E7681]">Sin pagos registrados</div>
          ) : (
            payments.map((p) => (
              <div
                key={p.id}
                className="text-xs border-t border-border/50 pt-2 first:border-0 first:pt-0"
                data-testid={`${testidPrefix}-details-row-${p.id}`}
              >
                <div className="flex justify-between">
                  <span className="text-[#6E7681]">{formatDate(p.date)}</span>
                  <span className="font-mono text-[#E6EDF3]">{formatCurrency(p.amount)}</span>
                </div>
                <div className="text-[#6E7681]">{p.accountName || '—'}</div>
                <div className="text-[#8B949E]">{p.notes || '—'}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/treasury/PaymentDetails.jsx
git commit -m "feat(treasury): componente PaymentDetails (lista colapsable de pagos)"
```

---

## Task 2: Integrar en `LoansPage` y `DebtsPage`

**Files:**
- Modify: `frontend/src/pages/treasury/LoansPage.jsx`
- Modify: `frontend/src/pages/treasury/DebtsPage.jsx`

- [ ] **Step 1: Importar el componente en `LoansPage`**

En `frontend/src/pages/treasury/LoansPage.jsx`, agregar el import (junto a los otros imports de componentes de treasury):

```jsx
import PaymentDetails from '@/components/treasury/PaymentDetails';
```

- [ ] **Step 2: Renderizar en la card de préstamo**

En `LoansPage.jsx`, dentro del `.map((loan) => { ... })`, justo después del `<div>` de botones de acción (el bloque `<div className="flex gap-2 pt-3 border-t border-border"> ... </div>` que contiene el botón `loan-card-${loan.id}-pay-button`), antes del cierre `</div>` de la card, agregar:

```jsx
                <PaymentDetails
                  testidPrefix={`loan-card-${loan.id}`}
                  payments={(loan.payments || []).map((p) => ({
                    id: p.id,
                    date: p.date,
                    amount: parseFloat(p.principalAmount) + parseFloat(p.extraAmount || 0),
                    accountName: p.account?.name,
                    notes: p.notes,
                  }))}
                />
```

- [ ] **Step 3: Importar el componente en `DebtsPage`**

En `frontend/src/pages/treasury/DebtsPage.jsx`, agregar el import:

```jsx
import PaymentDetails from '@/components/treasury/PaymentDetails';
```

- [ ] **Step 4: Renderizar en la card de crédito**

En `DebtsPage.jsx`, dentro del `.map((debt) => ...)`, justo después del `<div className="flex gap-2 pt-3 border-t border-border"> ... </div>` de botones (el que tiene `debt-card-${debt.id}-pay-button` / `-reconcile-button`), antes del cierre `</div>` de la card, agregar:

```jsx
                <PaymentDetails
                  testidPrefix={`debt-card-${debt.id}`}
                  payments={(debt.payments || []).map((p) => ({
                    id: p.id,
                    date: p.date,
                    amount: parseFloat(p.amount),
                    accountName: p.account?.name,
                    notes: p.notes,
                  }))}
                />
```

- [ ] **Step 5: Verificar build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/treasury/LoansPage.jsx frontend/src/pages/treasury/DebtsPage.jsx
git commit -m "feat(treasury): mostrar Detalles de pagos en cards de préstamos y créditos"
```

---

## Task 3: E2E — Detalles de pagos

**Files:**
- Create: `tests/e2e/treasury/payment-details.spec.ts`
- Reference: `tests/fixtures/auth.ts` (`loginAsAdmin`), `tests/helpers/api.ts` (`apiCreateLoan`, `apiAddLoanPayment`, `apiCreateDebt`, `apiAddDebtPayment`), `tests/global-setup.ts` (`TEST_SEED_IDS`)

- [ ] **Step 1: Crear el spec**

Crear `tests/e2e/treasury/payment-details.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateLoan, apiAddLoanPayment, apiCreateDebt, apiAddDebtPayment } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — Detalles de pagos en cards', () => {
  test('préstamo: la card muestra el pago en Detalles (fecha, valor, observación)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 2_000_000,
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 2_000_000 }],
    });
    // El pago de préstamo es un INGRESO (no requiere saldo en la cuenta destino).
    await apiAddLoanPayment(token, loan.id, {
      accountId: TEST_SEED_IDS.accountBank,
      principalAmount: 1_000_000,
      notes: 'pago prestamo de prueba',
    });

    await page.goto('/treasury/loans');
    await page.getByTestId(`loan-card-${loan.id}-details-toggle`).click();
    const details = page.getByTestId(`loan-card-${loan.id}-details`);
    await expect(details).toBeVisible();
    await expect(details).toContainText('pago prestamo de prueba');
  });

  test('crédito: la card muestra el pago en Detalles', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const debt = await apiCreateDebt(token, {
      name: 'Crédito detalles',
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 1_000_000 }],
    });
    // El pago de crédito es un EGRESO: usar una cuenta con saldo (Caja seed = 100M).
    await apiAddDebtPayment(token, debt.id, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 1_000_000,
      notes: 'pago credito de prueba',
    });

    await page.goto('/treasury/debts');
    await page.getByTestId(`debt-card-${debt.id}-details-toggle`).click();
    const details = page.getByTestId(`debt-card-${debt.id}-details`);
    await expect(details).toBeVisible();
    await expect(details).toContainText('pago credito de prueba');
  });
});
```

> Nota: se asierta sobre la observación (texto controlado por el test), que es lo más determinista. `apiAddLoanPayment` acepta `{ accountId, principalAmount, extraAmount?, date?, notes? }` y `apiAddDebtPayment` acepta `{ accountId, amount, notes? }` — confirmar firmas en `tests/helpers/api.ts` y ajustar si difieren.

- [ ] **Step 2: Correr el spec nuevo**

Run: `npx playwright test tests/e2e/treasury/payment-details.spec.ts`
Expected: 2 passed.

- [ ] **Step 3: Regresión de cards de préstamos/créditos**

Run: `npx playwright test tests/e2e/treasury/loans.spec.ts tests/e2e/treasury/loan-interest.spec.ts tests/e2e/treasury/debt-tracking.spec.ts`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/treasury/payment-details.spec.ts
git commit -m "test(treasury): e2e de Detalles de pagos en cards de préstamos y créditos"
```

---

## Verificación final

- [ ] **Build frontend:** `cd frontend && npm run build` → ok.
- [ ] **E2E:** `npx playwright test tests/e2e/treasury/` → verde.
- [ ] Invocar `verification-loop` antes de marcar completo.
```
