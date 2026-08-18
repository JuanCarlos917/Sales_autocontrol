# Comisiones e Inversionistas por mes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agrupar las secciones de pendientes y pagadas de `CommissionsPage` e `InvestorsPage` por mes de venta, con encabezado que muestra el count de negocios y el subtotal (total) del mes.

**Architecture:** Un helper puro (`monthGrouping.js`) agrupa una lista de ítems por mes de una fecha y calcula count + subtotal. Un componente compartido (`MonthGroupedGrid.jsx`) consume el helper y renderiza encabezado de mes + el grid de cards existente. Ambas páginas (que son espejo) reemplazan sus dos grids planos por ese componente. Sin cambios de backend.

**Tech Stack:** React 18 + Vite, TailwindCSS. Unit tests con Vitest (nuevo en el frontend). E2E con Playwright (root).

## Global Constraints

- Frontend: ES Modules (`import`). Componentes en PascalCase, hooks/funciones en camelCase.
- Idioma UI: Español (Colombia). Moneda COP sin decimales vía `formatCurrency` de `@/lib/constants`.
- Alias de imports: `@` → `frontend/src`.
- No mutar los arrays/objetos de entrada; el helper construye estructuras nuevas.
- Subtotal del mes = suma de `roles.total` de los ítems del grupo **excluyendo** roles con `status === 'CANCELLED'`.
- Fecha de agrupación = `item.vehicle.saleDate`. Meses en orden descendente; bucket `sin-fecha` al final.
- Data-testids requeridos: `month-group-<monthKey>` en cada grupo y `month-group-subtotal-<monthKey>` en el subtotal.

---

### Task 1: Helper puro `groupByMonth` + setup Vitest

**Files:**
- Modify: `frontend/vite.config.js` (cambiar import a `vitest/config` + añadir bloque `test`)
- Modify: `frontend/package.json` (script `test` + devDep `vitest`)
- Create: `frontend/src/lib/monthGrouping.js`
- Test: `frontend/src/lib/monthGrouping.test.js`

**Interfaces:**
- Produces:
  - `groupByMonth(items, { dateOf, sumOf }) => Array<{ monthKey: string, monthLabel: string, count: number, subtotal: number, items: any[] }>` — grupos ordenados por mes desc, `sin-fecha` al final; `items` de cada grupo ordenados por fecha desc.
  - `sumRolesTotal(item) => number` — suma `roles[].total` con `status !== 'CANCELLED'`.
  - `saleDateOf(item) => string | null` — devuelve `item.vehicle?.saleDate ?? null`.

- [ ] **Step 1: Instalar Vitest**

Run:
```bash
cd frontend && npm i -D vitest
```

- [ ] **Step 2: Habilitar Vitest en la config**

En `frontend/vite.config.js`, cambiar la primera línea de import y añadir el bloque `test` dentro de `defineConfig`:

```js
import { defineConfig } from 'vitest/config';
```

Y dentro del objeto de `defineConfig({ ... })`, junto a `plugins`, `resolve`, `server`, añadir:

```js
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
```

(`vitest/config` reexporta el `defineConfig` de Vite, así que el dev server y el proxy siguen igual.)

- [ ] **Step 3: Añadir el script de test**

En `frontend/package.json`, dentro de `"scripts"`, añadir:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Escribir el test que falla**

Crear `frontend/src/lib/monthGrouping.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { groupByMonth, sumRolesTotal, saleDateOf } from './monthGrouping';

const item = (saleDate, roles) => ({ vehicle: { saleDate }, roles });

describe('sumRolesTotal', () => {
  it('suma los totales de roles no cancelados', () => {
    const it1 = item('2026-08-10', [
      { total: 300, status: 'PAID' },
      { total: 700, status: 'PENDING' },
      { total: 999, status: 'CANCELLED' },
    ]);
    expect(sumRolesTotal(it1)).toBe(1000);
  });

  it('devuelve 0 sin roles', () => {
    expect(sumRolesTotal({ vehicle: {}, roles: [] })).toBe(0);
    expect(sumRolesTotal({ vehicle: {} })).toBe(0);
  });
});

describe('saleDateOf', () => {
  it('lee vehicle.saleDate y tolera ausencia', () => {
    expect(saleDateOf(item('2026-08-10', []))).toBe('2026-08-10');
    expect(saleDateOf({})).toBe(null);
  });
});

describe('groupByMonth', () => {
  const opts = { dateOf: saleDateOf, sumOf: sumRolesTotal };

  it('devuelve [] con lista vacía', () => {
    expect(groupByMonth([], opts)).toEqual([]);
  });

  it('agrupa por mes con count y subtotal', () => {
    const items = [
      item('2026-08-10', [{ total: 1000, status: 'PENDING' }]),
      item('2026-08-25', [{ total: 500, status: 'PAID' }]),
      item('2026-07-05', [{ total: 300, status: 'PAID' }]),
    ];
    const groups = groupByMonth(items, opts);
    expect(groups).toHaveLength(2);
    const aug = groups.find((g) => g.monthKey === '2026-08');
    expect(aug.count).toBe(2);
    expect(aug.subtotal).toBe(1500);
    expect(aug.monthLabel).toBe('Agosto 2026');
  });

  it('ordena los meses descendente', () => {
    const items = [
      item('2026-06-01', [{ total: 1, status: 'PAID' }]),
      item('2026-08-01', [{ total: 1, status: 'PAID' }]),
      item('2026-07-01', [{ total: 1, status: 'PAID' }]),
    ];
    const keys = groupByMonth(items, opts).map((g) => g.monthKey);
    expect(keys).toEqual(['2026-08', '2026-07', '2026-06']);
  });

  it('ordena los ítems dentro del mes por fecha descendente', () => {
    const items = [
      item('2026-08-05', [{ total: 1, status: 'PAID' }]),
      item('2026-08-28', [{ total: 1, status: 'PAID' }]),
    ];
    const aug = groupByMonth(items, opts)[0];
    expect(aug.items.map((i) => i.vehicle.saleDate)).toEqual(['2026-08-28', '2026-08-05']);
  });

  it('coloca los ítems sin fecha en un bucket al final', () => {
    const items = [
      item(null, [{ total: 1, status: 'PAID' }]),
      item('2026-08-01', [{ total: 1, status: 'PAID' }]),
    ];
    const groups = groupByMonth(items, opts);
    expect(groups[groups.length - 1].monthKey).toBe('sin-fecha');
    expect(groups[groups.length - 1].monthLabel).toBe('Sin fecha');
  });

  it('no muta la lista de entrada', () => {
    const items = [
      item('2026-08-05', [{ total: 1, status: 'PAID' }]),
      item('2026-08-28', [{ total: 1, status: 'PAID' }]),
    ];
    const snapshot = items.map((i) => i.vehicle.saleDate);
    groupByMonth(items, opts);
    expect(items.map((i) => i.vehicle.saleDate)).toEqual(snapshot);
  });
});
```

- [ ] **Step 5: Correr el test y verificar que falla**

Run: `cd frontend && npm test`
Expected: FAIL — `Failed to resolve import './monthGrouping'` (el módulo aún no existe).

- [ ] **Step 6: Implementar el helper**

Crear `frontend/src/lib/monthGrouping.js`:

```js
// ═══════════════════════════════════════════════════════════════
// monthGrouping — agrupa ítems (comisiones/ganancias) por mes de una fecha,
// con count de negocios y subtotal por mes. Función pura, sin React.
// ═══════════════════════════════════════════════════════════════

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Total del mes: suma de roles no cancelados.
export function sumRolesTotal(item) {
  return (item.roles || [])
    .filter((r) => r.status !== 'CANCELLED')
    .reduce((s, r) => s + (r.total || 0), 0);
}

// Fecha de agrupación de un ítem de comisión/ganancia.
export function saleDateOf(item) {
  return item.vehicle?.saleDate ?? null;
}

// Agrupa por mes. Grupos ordenados desc; 'sin-fecha' al final.
// Ítems de cada grupo ordenados por fecha descendente. No muta la entrada.
export function groupByMonth(items, { dateOf, sumOf }) {
  const groups = new Map();
  for (const item of items) {
    const raw = dateOf(item);
    const d = raw ? new Date(raw) : null;
    const valid = d && !Number.isNaN(d.getTime());
    const monthKey = valid
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : 'sin-fecha';
    const monthLabel = valid ? `${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}` : 'Sin fecha';
    if (!groups.has(monthKey)) {
      groups.set(monthKey, { monthKey, monthLabel, count: 0, subtotal: 0, items: [] });
    }
    const g = groups.get(monthKey);
    g.items = [...g.items, item];
    g.count += 1;
    g.subtotal += sumOf(item);
  }

  for (const g of groups.values()) {
    g.items = [...g.items].sort(
      (a, b) => new Date(dateOf(b) || 0) - new Date(dateOf(a) || 0),
    );
  }

  return [...groups.values()].sort((a, b) => {
    if (a.monthKey === 'sin-fecha') return 1;
    if (b.monthKey === 'sin-fecha') return -1;
    if (a.monthKey === b.monthKey) return 0;
    return a.monthKey < b.monthKey ? 1 : -1;
  });
}
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `cd frontend && npm test`
Expected: PASS — todos los tests de `monthGrouping.test.js` en verde.

- [ ] **Step 8: Commit**

```bash
git add frontend/vite.config.js frontend/package.json frontend/package-lock.json frontend/src/lib/monthGrouping.js frontend/src/lib/monthGrouping.test.js
git commit -m "feat(reporting): helper groupByMonth + setup Vitest"
```

---

### Task 2: Componente compartido `MonthGroupedGrid`

**Files:**
- Create: `frontend/src/components/treasury/MonthGroupedGrid.jsx`
- Modify: `frontend/src/components/treasury/index.js` (si existe barrel; ver Step 1)

**Interfaces:**
- Consumes: `groupByMonth` de `@/lib/monthGrouping`; `formatCurrency` de `@/lib/constants`.
- Produces: componente por defecto `MonthGroupedGrid` con props
  `{ items: any[], renderCard: (item) => ReactNode, sumOf: (item) => number, dateOf: (item) => (string|null) }`.
  `renderCard` debe devolver un elemento con `key`.

- [ ] **Step 1: Revisar el barrel de treasury**

Run: `sed -n '1,40p' frontend/src/components/treasury/index.js`
Si el archivo exporta componentes (p.ej. `export { PaymentModal } from './PaymentModal'`), añadir en el Step 3 la línea de export para `MonthGroupedGrid`. Si no existe barrel, las páginas importarán con ruta directa (ver Task 3/4) y se omite el cambio al índice.

- [ ] **Step 2: Crear el componente**

Crear `frontend/src/components/treasury/MonthGroupedGrid.jsx`:

```jsx
// ═══════════════════════════════════════════════════════════════
// MonthGroupedGrid — pinta una lista de cards agrupadas por mes, con
// encabezado (count de negocios) y subtotal del mes. Reutilizado por
// CommissionsPage e InvestorsPage.
// ═══════════════════════════════════════════════════════════════

import { groupByMonth } from '@/lib/monthGrouping';
import { formatCurrency } from '@/lib/constants';

export default function MonthGroupedGrid({ items, renderCard, sumOf, dateOf }) {
  const groups = groupByMonth(items, { dateOf, sumOf });

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.monthKey} data-testid={`month-group-${g.monthKey}`}>
          <div className="flex items-center justify-between mb-3 border-b border-border pb-1.5">
            <h4 className="text-sm font-semibold text-[#E6EDF3]">
              {g.monthLabel}
              <span className="text-[#6E7681] font-normal ml-2 text-xs">
                {g.count} {g.count === 1 ? 'negocio' : 'negocios'}
              </span>
            </h4>
            <span
              className="font-mono text-sm text-[#E6EDF3]"
              data-testid={`month-group-subtotal-${g.monthKey}`}
            >
              {formatCurrency(g.subtotal)} <span className="text-[#6E7681] text-xs">total</span>
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {g.items.map(renderCard)}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Exportar en el barrel (solo si existe)**

Si el Step 1 mostró un barrel, añadir a `frontend/src/components/treasury/index.js`:

```js
export { default as MonthGroupedGrid } from './MonthGroupedGrid';
```

- [ ] **Step 4: Verificar que compila**

Run: `cd frontend && npm run build`
Expected: build sin errores (el componente aún no se usa; solo confirma que importa bien).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/treasury/MonthGroupedGrid.jsx frontend/src/components/treasury/index.js
git commit -m "feat(reporting): componente MonthGroupedGrid"
```

---

### Task 3: Integrar en `CommissionsPage`

**Files:**
- Modify: `frontend/src/pages/treasury/CommissionsPage.jsx`

**Interfaces:**
- Consumes: `MonthGroupedGrid` (Task 2), `sumRolesTotal` + `saleDateOf` (Task 1).

- [ ] **Step 1: Añadir imports**

En `frontend/src/pages/treasury/CommissionsPage.jsx`, tras la línea `import { PaymentModal } from '@/components/treasury';` añadir:

```jsx
import MonthGroupedGrid from '@/components/treasury/MonthGroupedGrid';
import { sumRolesTotal, saleDateOf } from '@/lib/monthGrouping';
```

- [ ] **Step 2: Reemplazar el grid de pendientes**

Reemplazar este bloque:

```jsx
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {pending.map((item) => (
            <CommissionCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
          ))}
        </div>
```

por:

```jsx
        <MonthGroupedGrid
          items={pending}
          dateOf={saleDateOf}
          sumOf={sumRolesTotal}
          renderCard={(item) => (
            <CommissionCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
          )}
        />
```

- [ ] **Step 3: Reemplazar el grid de pagadas**

Reemplazar este bloque:

```jsx
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
              {paid.map((item) => (
                <CommissionCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
              ))}
            </div>
```

por:

```jsx
            <div className="mt-3">
              <MonthGroupedGrid
                items={paid}
                dateOf={saleDateOf}
                sumOf={sumRolesTotal}
                renderCard={(item) => (
                  <CommissionCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
                )}
              />
            </div>
```

- [ ] **Step 4: Verificar build**

Run: `cd frontend && npm run build`
Expected: build sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/treasury/CommissionsPage.jsx
git commit -m "feat(reporting): comisiones agrupadas por mes"
```

---

### Task 4: Integrar en `InvestorsPage`

**Files:**
- Modify: `frontend/src/pages/treasury/InvestorsPage.jsx`

**Interfaces:**
- Consumes: `MonthGroupedGrid` (Task 2), `sumRolesTotal` + `saleDateOf` (Task 1).

- [ ] **Step 1: Añadir imports**

En `frontend/src/pages/treasury/InvestorsPage.jsx`, tras la línea `import { PaymentModal } from '@/components/treasury';` añadir:

```jsx
import MonthGroupedGrid from '@/components/treasury/MonthGroupedGrid';
import { sumRolesTotal, saleDateOf } from '@/lib/monthGrouping';
```

- [ ] **Step 2: Reemplazar el grid de pendientes**

Reemplazar este bloque:

```jsx
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {pending.map((item) => (
            <InvestorCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
          ))}
        </div>
```

por:

```jsx
        <MonthGroupedGrid
          items={pending}
          dateOf={saleDateOf}
          sumOf={sumRolesTotal}
          renderCard={(item) => (
            <InvestorCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
          )}
        />
```

- [ ] **Step 3: Reemplazar el grid de pagadas**

Reemplazar este bloque:

```jsx
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
              {paid.map((item) => (
                <InvestorCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
              ))}
            </div>
```

por:

```jsx
            <div className="mt-3">
              <MonthGroupedGrid
                items={paid}
                dateOf={saleDateOf}
                sumOf={sumRolesTotal}
                renderCard={(item) => (
                  <InvestorCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
                )}
              />
            </div>
```

- [ ] **Step 4: Verificar build**

Run: `cd frontend && npm run build`
Expected: build sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/treasury/InvestorsPage.jsx
git commit -m "feat(reporting): ganancia inversionistas agrupada por mes"
```

---

### Task 5: E2E — encabezado de mes en CommissionsPage

**Files:**
- Modify: `tests/e2e/sales/commissions.spec.ts`

**Interfaces:**
- Consumes: helpers existentes `loginAsAdmin`, `apiCreateVehicle`, `apiRegisterSale`, `TEST_SEED_IDS`; los data-testids `commission-card-<plate>`, `month-group-<monthKey>`, `month-group-subtotal-<monthKey>` (Task 2/3).

- [ ] **Step 1: Añadir el test**

Dentro del `test.describe('Comisiones — configuración global', () => { ... })` de `tests/e2e/sales/commissions.spec.ts`, antes del cierre `});` del describe, añadir:

```ts
  test('CommissionsPage agrupa por mes con count de negocios y subtotal', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const plate = `MTH${Date.now().toString().slice(-6)}`;
    const v = await apiCreateVehicle(token, {
      plate,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: TEST_SEED_IDS.partner,  role: 'CERRADOR', sharePct: 70 },
      ],
    });

    await page.goto('/treasury/commissions');

    // La card de la venta (pendiente) aparece en la página
    await expect(page.getByTestId(`commission-card-${plate}`)).toBeVisible({ timeout: 10_000 });

    // Y está bajo el encabezado del mes actual (YYYY-MM), con count y subtotal
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const group = page.getByTestId(`month-group-${monthKey}`);
    await expect(group).toBeVisible();
    await expect(group).toContainText(/negocio/);
    await expect(page.getByTestId(`month-group-subtotal-${monthKey}`)).toContainText(/total/);
  });
```

- [ ] **Step 2: Correr el test e2e**

Run: `npm run test:e2e -- sales/commissions.spec.ts -g "agrupa por mes"`
Expected: PASS. (Requiere backend + frontend levantados según el setup e2e del repo; si el runner los arranca vía `webServer` en `playwright.config.ts`, basta el comando.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/sales/commissions.spec.ts
git commit -m "test(e2e): comisiones agrupadas por mes en CommissionsPage"
```

---

## Verificación final

- [ ] `cd frontend && npm test` — unit de `monthGrouping` en verde.
- [ ] `cd frontend && npm run build` — build de producción sin errores.
- [ ] `npm run test:e2e -- sales/commissions.spec.ts` — suite de comisiones en verde.
- [ ] Revisión visual manual en `/treasury/commissions` y `/treasury/investors`: encabezados de mes desc, count correcto (singular/plural), subtotal = total del mes (excluye canceladas), sección "Pagadas" colapsable intacta, KPIs y "Por persona" sin cambios.
