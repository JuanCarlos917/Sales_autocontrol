# Reverso Universal — UI Parte 1: Componentes compartidos + Préstamos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar UI de reverso a préstamos (reversar un pago, anular el préstamo) mediante componentes compartidos `<ReverseAction>` y `<ReversedBadge>` reutilizables por los demás dominios.

**Architecture:** Se extraen dos componentes compartidos del patrón de reverso de movimientos ya existente (`TransactionsPage`): `<ReverseAction>` (botón + modal con motivo ≥10 + guard de doble-submit + manejo de error) y `<ReversedBadge>`. El componente compartido `PaymentDetails` (usado por préstamos y créditos) gana soporte genérico de reverso por pago (`onReversePayment` + badge según `reversedAt`). `LoanDetailPage` cablea el reverso de pago y el "Anular préstamo". El backend ya expone los endpoints (Fase 2).

**Tech Stack:** React 18 + Vite + TailwindCSS. Cliente HTTP `src/lib/api.js` (axios). Tests: Playwright e2e de navegador (DB `autocontrol_test`). El frontend NO tiene unit tests ni lint script — la verificación estática es `npm run build`.

## Global Constraints

- Frontend en **ES Modules** (`import`). Componentes en PascalCase, en `src/components/{domain}/`.
- UI en **Español (Colombia)**; código en inglés.
- Reverso requiere **motivo ≥10 caracteres**; el botón de confirmar queda deshabilitado hasta cumplirlo y mientras hay un submit en curso (evita doble ejecución).
- Tema oscuro existente: superficies `bg-surface`, texto `#E6EDF3`/`#8B949E`, acento de reverso **ámbar** (`amber-600`), acento destructivo/anular **rojo** (`red-600`). Reusar la clase `input`, `btn-primary`, `btn-ghost` y el componente `@/components/shared/Modal`.
- Los errores de API se muestran al usuario (mensaje del backend si viene en `err.response.data.error`); en fallo el modal permanece abierto.
- `TransactionsPage` (reverso de movimientos, Fase 1) **NO se toca** en este plan — ya funciona y tiene e2e. Su refactor a los componentes compartidos es un follow-up posterior.
- Endpoints backend ya existentes: `POST /loan-payments/:id/reverse`, `POST /loans/:id/reverse` (ADMIN, `{ reason }`).

---

## File Structure

- **Create** `frontend/src/components/shared/ReverseAction.jsx` — botón + modal de reverso reutilizable.
- **Create** `frontend/src/components/shared/ReversedBadge.jsx` — badge de estado reversado/anulado.
- **Modify** `frontend/src/lib/treasuryApi.js` — `loansApi.reversePayment`, `loansApi.reverseLoan`.
- **Modify** `frontend/src/components/treasury/PaymentDetails.jsx` — prop `onReversePayment` + badge por `reversedAt`.
- **Modify** `frontend/src/pages/treasury/LoanDetailPage.jsx` — cablear reverso de pago + "Anular préstamo" + reload; incluir `reversedAt` en el mapeo de pagos.
- **Create** `tests/e2e/treasury/loan-reverse-ui.spec.ts` — e2e de navegador.

---

## Task 1: Componentes compartidos + cliente API + PaymentDetails

**Files:**
- Create: `frontend/src/components/shared/ReverseAction.jsx`
- Create: `frontend/src/components/shared/ReversedBadge.jsx`
- Modify: `frontend/src/lib/treasuryApi.js`
- Modify: `frontend/src/components/treasury/PaymentDetails.jsx`

**Interfaces:**
- Produces:
  - `<ReverseAction label title description confirmLabel variant testid onConfirm onDone buttonClassName />` — `onConfirm: (reason: string) => Promise<void>`; maneja estado interno (open/reason/submitting/error); testids derivados de `testid`: `${testid}-reverse-btn`, `${testid}-reverse-modal`, `${testid}-reverse-reason`, `${testid}-reverse-confirm`.
  - `<ReversedBadge label variant testid />`.
  - `loansApi.reversePayment(paymentId, reason)`, `loansApi.reverseLoan(id, reason)`.
  - `<PaymentDetails … onReversePayment?={(payment, reason) => Promise<void>} />` — por fila: si `payment.reversedAt` muestra `<ReversedBadge>`; si no y hay `onReversePayment`, muestra un `<ReverseAction>` "Reversar".

- [ ] **Step 1: Crear `ReversedBadge.jsx`**

Crear `frontend/src/components/shared/ReversedBadge.jsx`:

```jsx
// Badge de estado para entidades reversadas/anuladas/inactivas.
const VARIANTS = {
  zinc: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export default function ReversedBadge({ label = 'Reversado', variant = 'zinc', testid }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${VARIANTS[variant] || VARIANTS.zinc}`}
      data-testid={testid}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Crear `ReverseAction.jsx`**

Crear `frontend/src/components/shared/ReverseAction.jsx`:

```jsx
import { useState } from 'react';
import Modal from '@/components/shared/Modal';

const MIN_REASON = 10;

const BTN_VARIANT = {
  amber: 'text-amber-400 hover:text-amber-300',
  red: 'text-red-400 hover:text-red-300',
};

const CONFIRM_VARIANT = {
  amber: 'bg-amber-600 hover:bg-amber-700',
  red: 'bg-red-600 hover:bg-red-700',
};

// Botón + modal de reverso reutilizable. `onConfirm(reason)` debe lanzar en error.
export default function ReverseAction({
  label = 'Reversar',
  title = 'Reversar',
  description = null,
  confirmLabel = 'Reversar',
  variant = 'amber',
  testid,
  onConfirm,
  onDone,
  buttonClassName = '',
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const close = () => {
    setOpen(false);
    setReason('');
    setError(null);
  };

  const handleConfirm = async () => {
    if (reason.trim().length < MIN_REASON || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      close();
      if (onDone) onDone();
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo completar el reverso');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`btn-ghost text-xs ${BTN_VARIANT[variant] || BTN_VARIANT.amber} ${buttonClassName}`}
        data-testid={`${testid}-reverse-btn`}
      >
        {label}
      </button>

      <Modal isOpen={open} onClose={close} title={title}>
        <div className="space-y-4" data-testid={`${testid}-reverse-modal`}>
          {description && <div className="text-sm text-[#8B949E]">{description}</div>}
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Motivo * (mín 10 caracteres)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input w-full"
              rows={3}
              data-testid={`${testid}-reverse-reason`}
            />
          </div>
          {error && <p className="text-sm text-red-400" data-testid={`${testid}-reverse-error`}>{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={close} className="btn-ghost flex-1">Cancelar</button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={reason.trim().length < MIN_REASON || submitting}
              className={`btn-primary flex-1 ${CONFIRM_VARIANT[variant] || CONFIRM_VARIANT.amber} disabled:opacity-50`}
              data-testid={`${testid}-reverse-confirm`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
```

- [ ] **Step 3: Añadir métodos al cliente API**

En `frontend/src/lib/treasuryApi.js`, dentro del objeto `loansApi`, añadir (después de `addPayment`):

```js
  reversePayment: (paymentId, reason) => api.post(`/loan-payments/${paymentId}/reverse`, { reason }),
  reverseLoan: (id, reason) => api.post(`/loans/${id}/reverse`, { reason }),
```

- [ ] **Step 4: Extender `PaymentDetails.jsx`**

En `frontend/src/components/treasury/PaymentDetails.jsx`:

Añadir imports al tope:

```js
import ReverseAction from '@/components/shared/ReverseAction';
import ReversedBadge from '@/components/shared/ReversedBadge';
```

Cambiar la firma para aceptar `onReversePayment`:

```js
export default function PaymentDetails({ payments = [], testidPrefix, alwaysOpen = false, onReversePayment }) {
```

Dentro del `.map((p) => (...))`, reemplazar el bloque de la fila por (añade el control de reverso a la derecha de la fecha/monto):

```jsx
            payments.map((p) => (
              <div
                key={p.id}
                className="text-xs border-t border-border/50 pt-2 first:border-0 first:pt-0"
                data-testid={`${testidPrefix}-details-row-${p.id}`}
              >
                <div className="flex justify-between items-center gap-2">
                  <span className="text-[#6E7681]">{formatDate(p.date)}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[#E6EDF3]">{formatCurrency(p.amount)}</span>
                    {p.reversedAt ? (
                      <ReversedBadge label="Reversado" testid={`${testidPrefix}-row-${p.id}-reversed`} />
                    ) : onReversePayment ? (
                      <ReverseAction
                        label="Reversar"
                        title="Reversar pago"
                        description={<>Se creará un movimiento compensatorio que devuelve {formatCurrency(p.amount)} a la cuenta. El pago original no se borra.</>}
                        variant="amber"
                        testid={`${testidPrefix}-pay-${p.id}`}
                        onConfirm={(reason) => onReversePayment(p, reason)}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="text-[#6E7681]">{p.accountName || '—'}</div>
                <div className="text-[#8B949E]">{p.notes || '—'}</div>
              </div>
            ))
```

(El resto del componente queda igual. Los consumidores que no pasen `onReversePayment` no muestran botón — comportamiento retrocompatible.)

- [ ] **Step 5: Verificar build**

Run: `cd frontend && npm run build 2>&1 | tail -4`
Expected: `✓ built in …` sin errores (los componentes compilan; PaymentDetails sigue válido para sus dos consumidores).

- [ ] **Step 6: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add frontend/src/components/shared/ReverseAction.jsx frontend/src/components/shared/ReversedBadge.jsx frontend/src/lib/treasuryApi.js frontend/src/components/treasury/PaymentDetails.jsx
git commit -m "feat(ui): componentes compartidos ReverseAction/ReversedBadge + reverso de pago en PaymentDetails"
```

---

## Task 2: Cablear LoanDetailPage + e2e de navegador

**Files:**
- Modify: `frontend/src/pages/treasury/LoanDetailPage.jsx`
- Create: `tests/e2e/treasury/loan-reverse-ui.spec.ts`

**Interfaces:**
- Consumes: `<ReverseAction>`, `loansApi.reversePayment`, `loansApi.reverseLoan`, `<PaymentDetails onReversePayment>` (Task 1).
- Produces (testids para e2e): botón anular préstamo `loan-detail-reverse-btn` (+ `-reverse-modal/-reverse-reason/-reverse-confirm`); por pago `loan-detail-pay-<paymentId>-reverse-btn` (+ modal/reason/confirm); badge de pago reversado `loan-detail-row-<paymentId>-reversed`.

- [ ] **Step 1: Refactor de carga + imports en `LoanDetailPage.jsx`**

Añadir import al tope:

```js
import ReverseAction from '@/components/shared/ReverseAction';
```

Refactorizar la carga para poder recargar tras un reverso. Reemplazar el `useEffect` que hace el fetch por una función `load` reutilizable:

```jsx
  const load = async () => {
    try {
      const { data } = await loansApi.getById(id);
      setLoan(data);
      setNotFound(false);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
```

(Ajustar a los nombres de setters existentes en el archivo: `setLoan`, `setNotFound`, `setLoading`.)

- [ ] **Step 2: Incluir `reversedAt` en el mapeo de pagos**

En el mapeo `const payments = (loan.payments || []).map((p) => ({ … }))`, añadir el campo `reversedAt`:

```js
  const payments = (loan.payments || []).map((p) => ({
    id: p.id,
    date: p.date,
    amount: parseFloat(p.principalAmount) + parseFloat(p.extraAmount || 0),
    accountName: p.account?.name,
    notes: p.notes,
    reversedAt: p.reversedAt,
  }));
```

- [ ] **Step 3: Cablear reverso de pago en `PaymentDetails`**

Donde se renderiza `<PaymentDetails testidPrefix="loan-detail" payments={payments} alwaysOpen />`, añadir el callback:

```jsx
          <PaymentDetails
            testidPrefix="loan-detail"
            payments={payments}
            alwaysOpen
            onReversePayment={async (p, reason) => {
              await loansApi.reversePayment(p.id, reason);
              await load();
            }}
          />
```

- [ ] **Step 4: Botón "Anular préstamo" en el header**

En el header, junto al `<span>` del estado (`STATUS_LABEL[loan.status]`), envolver en un contenedor flex y añadir el `<ReverseAction>` solo si el préstamo no está cancelado:

```jsx
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-1 rounded font-medium ${STATUS_COLOR[loan.status]}`}>
            {STATUS_LABEL[loan.status]}
          </span>
          {loan.status !== 'CANCELLED' && (
            <ReverseAction
              label="Anular préstamo"
              title="Anular préstamo"
              description={<>Se reversarán el desembolso y todos los pagos vivos (asientos compensatorios). El préstamo quedará CANCELADO. Esta acción no se puede deshacer.</>}
              confirmLabel="Anular préstamo"
              variant="red"
              testid="loan-detail"
              onConfirm={(reason) => loansApi.reverseLoan(id, reason)}
              onDone={load}
            />
          )}
        </div>
```

(Reemplaza el `<span>` suelto del estado por este contenedor.)

- [ ] **Step 5: Verificar build**

Run: `cd frontend && npm run build 2>&1 | tail -4`
Expected: `✓ built in …` sin errores.

- [ ] **Step 6: Escribir el e2e de navegador que falla**

Crear `tests/e2e/treasury/loan-reverse-ui.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateLoan, apiAddLoanPayment, apiGetLoan } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

function isoDueDates(n: number): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(base);
    d.setMonth(d.getMonth() + i);
    out.push(d.toISOString());
  }
  return out;
}

test.describe('Préstamos — reverso desde la UI', () => {
  test('admin reversa un pago y aparece el badge Reversado', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(2);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 1_000_000,
      interestRate: 0,
      installments: [
        { sequence: 1, dueDate: due[0], plannedAmount: 500_000 },
        { sequence: 2, dueDate: due[1], plannedAmount: 500_000 },
      ],
    });
    await apiAddLoanPayment(token, loan.id, { accountId: TEST_SEED_IDS.accountCash, principalAmount: 500_000 });
    const paymentId = (await apiGetLoan(token, loan.id)).payments[0].id;

    await page.goto(`/treasury/loans/${loan.id}`);
    await expect(page.getByTestId('loan-detail-page')).toBeVisible();

    await page.getByTestId(`loan-detail-pay-${paymentId}-reverse-btn`).click();
    await expect(page.getByTestId(`loan-detail-pay-${paymentId}-reverse-modal`)).toBeVisible();

    const confirm = page.getByTestId(`loan-detail-pay-${paymentId}-reverse-confirm`);
    await expect(confirm).toBeDisabled();
    await page.getByTestId(`loan-detail-pay-${paymentId}-reverse-reason`).fill('pago duplicado, corregir');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByTestId(`loan-detail-row-${paymentId}-reversed`)).toBeVisible({ timeout: 10_000 });
  });

  test('admin anula el préstamo completo y queda CANCELADO', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(1);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 300_000,
      interestRate: 0,
      installments: [{ sequence: 1, dueDate: due[0], plannedAmount: 300_000 }],
    });
    await apiAddLoanPayment(token, loan.id, { accountId: TEST_SEED_IDS.accountCash, principalAmount: 100_000 });

    await page.goto(`/treasury/loans/${loan.id}`);
    await page.getByTestId('loan-detail-reverse-btn').click();
    await expect(page.getByTestId('loan-detail-reverse-modal')).toBeVisible();
    await page.getByTestId('loan-detail-reverse-reason').fill('préstamo cargado por error');
    await page.getByTestId('loan-detail-reverse-confirm').click();

    // Tras anular, el botón desaparece (status CANCELLED) y el texto de estado lo refleja.
    await expect(page.getByTestId('loan-detail-reverse-btn')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('loan-detail-page')).toContainText(/Cancelad/i);
  });
});
```

- [ ] **Step 7: Correr el e2e**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
lsof -tiTCP:4000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
lsof -tiTCP:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/loan-reverse-ui.spec.ts --project=chromium 2>&1 | tail -15
```
Expected: `2 passed`.

- [ ] **Step 8: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add frontend/src/pages/treasury/LoanDetailPage.jsx tests/e2e/treasury/loan-reverse-ui.spec.ts
git commit -m "feat(ui): reverso de pago y anulación de préstamo en LoanDetailPage + e2e"
```

---

## Definition of Done (UI Parte 1)

- [ ] `<ReverseAction>` y `<ReversedBadge>` compartidos creados; `npm run build` verde.
- [ ] `PaymentDetails` muestra "Reversar" por pago (si `onReversePayment`) o badge "Reversado" (si `reversedAt`), retrocompatible.
- [ ] `LoanDetailPage`: reversar pago actualiza la vista con badge; "Anular préstamo" deja el préstamo CANCELADO.
- [ ] `loan-reverse-ui.spec.ts` 2/2 en navegador real.

## Notas / Fuera de alcance

- **STATUS_LABEL de CANCELLED:** confirmado `= 'Cancelado'` en `LoanDetailPage:9`; el e2e usa `toContainText(/Cancelad/i)`, que coincide. Ruta del detalle confirmada: `/treasury/loans/:id`.
- **Créditos / arqueos / cuentas:** planes de UI siguientes que reutilizan `<ReverseAction>`/`<ReversedBadge>` (créditos ya reusa `PaymentDetails`, así que su cableado es análogo a Task 2 + manejo de pagos reconciliados que no muestran botón).
- **Retrofit de `TransactionsPage`** a los componentes compartidos: follow-up de limpieza (Fase 6), no urgente.
- El frontend no tiene unit tests; la verificación es `npm run build` + e2e de navegador (consistente con el repo).
