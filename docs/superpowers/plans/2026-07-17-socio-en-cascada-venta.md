# Socio (partner) en la cascada de venta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer la cascada de venta consciente del socio: las reservas (reinversión/impuestos) se calculan solo sobre la parte del fondo, la comisión se reparte por % invertido con la parte del socio como Cuenta por Cobrar, y la ganancia del socio se le paga aparte (nuevo tipo `PARTNER_SHARE`).

**Architecture:** El cálculo se centraliza en `calculateSaleDistribution` (función pura en `financial.js`), extendida con contexto de socio. `registerSale` persiste una CxP `PARTNER_SHARE` (ganancia del socio) + una `RECEIVABLE` (su comisión) además de lo actual. La detección externo/inversionista vive en un helper `resolveSocio`. Sin socio → comportamiento idéntico al actual (regresión cero).

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (backend, CommonJS); React 18 + Vite + Tailwind (frontend). Tests: `node:test` (backend), Playwright (e2e).

## Global Constraints

- Backend CommonJS (`require`); moneda COP entera, redondeo con `roundCop`.
- Cálculos financieros centralizados en `backend/src/utils/financial.js`.
- `socioShare = 1 − participation`; `fundShare = participation`.
- Externo vs inversionista: socio es inversionista si `partnerId === 'owner-self'` o `partnerId ∈ investor_team`.
- Regla: socio inversionista ⟺ 100% (`socioShare === 1`); socio externo ⟺ parcial (`0 < socioShare < 1`).
- Reservas: externo → solo sobre `fundShare × afterCommission`; inversionista(100%) → sobre `afterCommission` completo.
- Comisión sobre bruta (`commission_gross_pct %`), repartida por % invertido; socio debe su parte como RECEIVABLE.
- `partnerCommissionOwed = round(socioShare × commissionPool)`.
- Externo: `partnerProfit = round(socioShare × grossProfit)` (sin reservas). Inversionista(100%): `partnerProfit = grossProfit − reinvestAmount − taxAmount`.
- Ganancia del socio = `PARTNER_SHARE` (NO `PROFIT_SHARE`): la página de Inversionistas sigue siendo solo del fondo.
- Sin socio → cascada idéntica a la actual.
- Fuera de alcance: devolución del capital del socio; socio inversionista parcial; múltiples socios por carro.

---

## File Structure

- `backend/prisma/schema.prisma` — enum `PayableType` (+`PARTNER_SHARE`).
- `backend/prisma/migrations/<ts>_payable_type_partner_share/migration.sql` — `ALTER TYPE ADD VALUE`.
- `backend/src/services/commissionService.js` — `resolveSocio(prismaOrTx, vehicle, cfg)`.
- `backend/src/utils/financial.js` — `calculateSaleDistribution` extendida con `socio`.
- `backend/src/services/saleService.js` — paso 5 de `registerSale` crea PARTNER_SHARE + RECEIVABLE del socio; `cancelSale` cubre PARTNER_SHARE.
- `backend/src/services/payableService.js` — `getSummary` incluye `PARTNER_SHARE` en el total por pagar.
- `frontend/src/components/vehicles/VehicleFormModal.jsx` — validación en vivo inversionista⟺100%.
- `frontend/src/components/treasury/SalePaymentModal.jsx` (o card de comisión) — "el socio [nombre] debe pagar $X".
- `tests/e2e/treasury/socio.spec.ts` — flujo completo.

---

## Task 1: Esquema + migración (`PARTNER_SHARE`)

**Files:**
- Modify: `backend/prisma/schema.prisma` (enum `PayableType`)
- Create: `backend/prisma/migrations/20260717120000_payable_type_partner_share/migration.sql`

**Interfaces:**
- Produces: valor de enum `PayableType.PARTNER_SHARE`.

- [ ] **Step 1: Agregar el valor al enum**

En `enum PayableType` agregar `PARTNER_SHARE` (después de `PROFIT_SHARE`):

```prisma
enum PayableType {
  RECEIVABLE
  PAYABLE
  COMMISSION
  PROFIT_SHARE
  PARTNER_SHARE
}
```

- [ ] **Step 2: Escribir la migración**

Crear `backend/prisma/migrations/20260717120000_payable_type_partner_share/migration.sql`:

```sql
-- Ganancia del socio (co-inversor de un carro) como CxP propia, separada de la
-- del fondo (PROFIT_SHARE), para no mezclar al socio con los inversionistas.
ALTER TYPE "PayableType" ADD VALUE IF NOT EXISTS 'PARTNER_SHARE';
```

- [ ] **Step 3: Regenerar cliente y validar**

Run: `cd backend && npx prisma generate && npx prisma validate`
Expected: "Generated Prisma Client" y "schema ... is valid".

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260717120000_payable_type_partner_share/
git commit -m "feat(db): PayableType PARTNER_SHARE (ganancia del socio)"
```

---

## Task 2: `resolveSocio` + validación de la regla 100%

**Files:**
- Modify: `backend/src/services/commissionService.js`
- Test: `backend/src/services/__tests__/commissionService.test.js`

**Interfaces:**
- Consumes: `cfg.investorTeam` (de `loadCommissionConfig`), `AppError`, `OWNER_ID`.
- Produces:
  `resolveSocio(prismaOrTx, vehicle, cfg)` → `null` si no hay socio, o
  `{ thirdPartyId, share, isInvestor }` donde `share = 1 − participation` (redondeado a 4 decimales),
  `isInvestor = thirdPartyId === OWNER_ID || cfg.investorTeam.some(i => i.thirdPartyId === thirdPartyId)`.
  Lanza `AppError(400)` si `isInvestor && share !== 1` ("Un socio inversionista debe poner el 100% del vehículo") o si `!isInvestor && share === 1` ("Un socio externo no puede poner el 100%; debe ser un inversionista").

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `backend/src/services/__tests__/commissionService.test.js`:

```javascript
const { resolveSocio } = require('../commissionService');

const CFG_SOCIO = { investorTeam: [
  { thirdPartyId: 'owner-self', sharePct: 50 },
  { thirdPartyId: 'tp-mama', sharePct: 25 },
  { thirdPartyId: 'tp-papa', sharePct: 25 },
] };

test('resolveSocio: sin partnerId → null', async () => {
  const out = await resolveSocio(mkTx(), { partnerId: null, participation: 1 }, CFG_SOCIO);
  assert.equal(out, null);
});

test('resolveSocio: externo parcial → share 0.4, isInvestor false', async () => {
  const out = await resolveSocio(mkTx(), { partnerId: 'tp-externo', participation: 0.6 }, CFG_SOCIO);
  assert.equal(out.thirdPartyId, 'tp-externo');
  assert.equal(out.share, 0.4);
  assert.equal(out.isInvestor, false);
});

test('resolveSocio: inversionista al 100% → share 1, isInvestor true', async () => {
  const out = await resolveSocio(mkTx(), { partnerId: 'tp-mama', participation: 0 }, CFG_SOCIO);
  assert.equal(out.share, 1);
  assert.equal(out.isInvestor, true);
});

test('resolveSocio: inversionista parcial → 400', async () => {
  await assert.rejects(
    resolveSocio(mkTx(), { partnerId: 'tp-mama', participation: 0.6 }, CFG_SOCIO),
    (e) => e instanceof AppError && e.statusCode === 400 && /100%/.test(e.message),
  );
});

test('resolveSocio: externo al 100% → 400', async () => {
  await assert.rejects(
    resolveSocio(mkTx(), { partnerId: 'tp-externo', participation: 0 }, CFG_SOCIO),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd backend && node --test src/services/__tests__/commissionService.test.js`
Expected: FAIL — `resolveSocio is not a function`.

- [ ] **Step 3: Implementar `resolveSocio`**

En `backend/src/services/commissionService.js` (y exportar):

```javascript
function resolveSocio(prismaOrTx, vehicle, cfg) {
  if (!vehicle.partnerId) return null;
  const share = Math.round((1 - Number(vehicle.participation ?? 1)) * 10000) / 10000;
  if (share <= 0) return null; // participation 1 = sin socio efectivo
  const team = Array.isArray(cfg?.investorTeam) ? cfg.investorTeam : [];
  const isInvestor = vehicle.partnerId === OWNER_ID || team.some((i) => i.thirdPartyId === vehicle.partnerId);
  if (isInvestor && share !== 1) {
    throw new AppError('Un socio inversionista debe poner el 100% del vehículo', 400);
  }
  if (!isInvestor && share === 1) {
    throw new AppError('Un socio externo no puede poner el 100%; debe ser un inversionista', 400);
  }
  return { thirdPartyId: vehicle.partnerId, share, isInvestor };
}
```

Nota: `resolveSocio` es síncrona pero se declara/consume con `await` sin problema (devuelve valor plano). Mantener la firma `(prismaOrTx, vehicle, cfg)` por consistencia con los otros `resolve*`.

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `cd backend && node --test src/`
Expected: PASS (todo el backend).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/commissionService.js backend/src/services/__tests__/commissionService.test.js
git commit -m "feat: resolveSocio (detección externo/inversionista + regla 100%)"
```

---

## Task 3: `calculateSaleDistribution` consciente del socio

**Files:**
- Modify: `backend/src/utils/financial.js` (`calculateSaleDistribution`, ~línea 301)
- Test: `backend/src/utils/__tests__/financial.test.js`

**Interfaces:**
- Consumes: `roundCop`.
- Produces: `calculateSaleDistribution(vehicle, cfg, { sellers, investors, socio })` con `socio = { thirdPartyId, share, isInvestor } | null`. Nuevos campos en el retorno: `socioShare`, `socioIsInvestor`, `partnerProfit`, `partnerCommissionOwed`, `partnerThirdPartyId`. `reinvestAmount`/`taxAmount`/`profitToDistribute`/`investorRows` ahora se calculan sobre la parte del fondo cuando hay socio.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `backend/src/utils/__tests__/financial.test.js`:

```javascript
const socioCfg = { commissionGrossPct: 10, reinvestPct: 30, taxPct: 10 };
const oneSellerS = [{ thirdPartyId: 'v', role: 'CERRADOR', sharePct: 100 }];
const teamS = [
  { thirdPartyId: 'owner-self', role: 'INVESTOR', sharePct: 50 },
  { thirdPartyId: 'mama', role: 'INVESTOR', sharePct: 25 },
  { thirdPartyId: 'papa', role: 'INVESTOR', sharePct: 25 },
];
// bruta = 30M − 20M = 10M
const vBase = { salePrice: 30_000_000, purchasePrice: 20_000_000, expenses: [] };

test('dist socio externo 40%: reservas solo sobre parte del fondo; comisión por %', () => {
  const d = calculateSaleDistribution(vBase, socioCfg,
    { sellers: oneSellerS, investors: teamS, socio: { thirdPartyId: 'ext', share: 0.4, isInvestor: false } });
  assert.equal(d.grossProfit, 10_000_000);
  assert.equal(d.commissionPool, 1_000_000);
  assert.equal(d.partnerProfit, 4_000_000);        // 40% × bruta, sin reservas
  assert.equal(d.partnerCommissionOwed, 400_000);  // 40% × comisión
  assert.equal(d.reinvestAmount, 1_620_000);       // 30% × (60% × 9M)
  assert.equal(d.taxAmount, 540_000);              // 10% × (60% × 9M)
  assert.equal(d.profitToDistribute, 3_240_000);   // 5.4M − 1.62M − 0.54M
  assert.equal(d.investorRows.reduce((s, r) => s + r.amount, 0), 3_240_000);
});

test('dist socio inversionista 100%: reservas sobre todo; reparto al fondo 0', () => {
  const d = calculateSaleDistribution(vBase, socioCfg,
    { sellers: oneSellerS, investors: teamS, socio: { thirdPartyId: 'mama', share: 1, isInvestor: true } });
  assert.equal(d.reinvestAmount, 2_700_000);       // 30% × 9M
  assert.equal(d.taxAmount, 900_000);              // 10% × 9M
  assert.equal(d.partnerProfit, 6_400_000);        // bruta − reservas
  assert.equal(d.partnerCommissionOwed, 1_000_000);
  assert.equal(d.profitToDistribute, 0);
  assert.equal(d.investorRows.length, 0);
});

test('dist sin socio: idéntico al comportamiento actual', () => {
  const d = calculateSaleDistribution(vBase, socioCfg, { sellers: oneSellerS, investors: teamS, socio: null });
  assert.equal(d.partnerProfit, 0);
  assert.equal(d.partnerCommissionOwed, 0);
  assert.equal(d.reinvestAmount, 1_350_000);       // 30% × 9M
  assert.equal(d.taxAmount, 450_000);
  assert.equal(d.profitToDistribute, 2_700_000);
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: FAIL (los nuevos campos no existen / valores viejos).

- [ ] **Step 3: Implementar la lógica de socio**

En `calculateSaleDistribution` (backend/src/utils/financial.js), después de calcular `grossProfit`, `commissionPool` y `afterCommission`, reemplazar el cálculo de reservas/`profitToDistribute` por lógica consciente del socio. El `skip` sigue devolviendo `partnerProfit:0, partnerCommissionOwed:0, socioShare:0`. Con `grossProfit > 0`:

```javascript
const socioShare = socio ? Number(socio.share) : 0;
const fundShare = 1 - socioShare;
const partnerCommissionOwed = socio ? roundCop((commissionPool) * socioShare) : 0;

let reinvestAmount, taxAmount, profitToDistribute, partnerProfit;
if (!socio) {
  reinvestAmount = roundCop((Number(cfg.reinvestPct) / 100) * afterCommission);
  taxAmount      = roundCop((Number(cfg.taxPct) / 100) * afterCommission);
  profitToDistribute = afterCommission - reinvestAmount - taxAmount;
  partnerProfit = 0;
} else if (socio.isInvestor) {
  // Inversionista 100%: reservas sobre todo, socio se queda el resto, fondo 0.
  reinvestAmount = roundCop((Number(cfg.reinvestPct) / 100) * afterCommission);
  taxAmount      = roundCop((Number(cfg.taxPct) / 100) * afterCommission);
  partnerProfit  = grossProfit - reinvestAmount - taxAmount;
  profitToDistribute = 0;
} else {
  // Externo parcial: reservas solo sobre la parte del fondo; socio sin reservas.
  const fundAfterCommission = fundShare * afterCommission;
  reinvestAmount = roundCop((Number(cfg.reinvestPct) / 100) * fundAfterCommission);
  taxAmount      = roundCop((Number(cfg.taxPct) / 100) * fundAfterCommission);
  profitToDistribute = roundCop(fundAfterCommission) - reinvestAmount - taxAmount;
  partnerProfit  = roundCop(socioShare * grossProfit);
}
```

Luego `investorRows = split(investors, profitToDistribute, 'owner-self')` (igual que hoy, pero sobre el `profitToDistribute` del fondo; si es 0, `split` devuelve filas en 0 — filtrar a `[]` si `profitToDistribute === 0`). Añadir al objeto retornado: `socioShare`, `socioIsInvestor: !!(socio && socio.isInvestor)`, `partnerProfit`, `partnerCommissionOwed`, `partnerThirdPartyId: socio ? socio.thirdPartyId : null`.

Nota: cuando `profitToDistribute === 0`, `investorRows` debe ser `[]` (no filas en 0) para no crear CxP `PROFIT_SHARE` vacías. Ajustar el `split`/filtrado en consecuencia.

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `cd backend && node --test src/`
Expected: PASS (incluye los tests previos de `calculateSaleDistribution` sin socio, sin regresión).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/financial.js backend/src/utils/__tests__/financial.test.js
git commit -m "feat: calculateSaleDistribution consciente del socio (reservas parte fondo, PARTNER_SHARE)"
```

---

## Task 4: `registerSale` crea `PARTNER_SHARE` + `RECEIVABLE` del socio

**Files:**
- Modify: `backend/src/services/saleService.js` (paso 5 de `registerSale`, ~líneas 207-348)
- Test: `backend/src/services/__tests__/saleService.dist.test.js`

**Interfaces:**
- Consumes: `resolveSocio` (Task 2), `calculateSaleDistribution` con socio (Task 3).
- Produces: en una venta con socio, CxP `PARTNER_SHARE` (ganancia del socio) + CxP `RECEIVABLE` (comisión del socio) + `PROFIT_SHARE`/reservas sobre la parte del fondo.

- [ ] **Step 1: Test de integración que falla**

Ampliar el stub de `saleService.dist.test.js` para capturar `payable.create` por tipo. Añadir un caso: vehículo con `partnerId: 'ext'`, `participation: 0.6`, venta 30M/costo 20M, 1 vendedor 100%, investor_team 50/25/25. Aserciones:

```javascript
assert.equal(created.payablesByType.PARTNER_SHARE.length, 1);
assert.equal(created.payablesByType.PARTNER_SHARE[0].totalAmount, 4_000_000);
assert.equal(created.payablesByType.PARTNER_SHARE[0].thirdPartyId, 'ext');
const socioRec = created.payablesByType.RECEIVABLE.find(p => /Comisión socio/.test(p.description));
assert.equal(socioRec.totalAmount, 400_000);
assert.equal(sum(created.payablesByType.PROFIT_SHARE, 'totalAmount'), 3_240_000);
```

(Modelar el stub sobre el `mkTx` existente; el vehículo del stub debe incluir `partnerId`/`participation`.)

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd backend && node --test src/services/__tests__/saleService.dist.test.js`
Expected: FAIL (aún no crea PARTNER_SHARE ni la RECEIVABLE del socio).

- [ ] **Step 3: Integrar en el paso 5**

En `registerSale`, tras `const dist = calculateSaleDistribution(...)`, resolver el socio y pasarlo:

```javascript
const socio = commissionService.resolveSocio(tx, vehicle, cfg);
const dist = calculateSaleDistribution(vehicleForBase, cfg.distributionCfg, { sellers, investors, socio });
```

Dentro de `if (!dist.skip)`, después de crear COMMISSION y PROFIT_SHARE, agregar (solo si hay socio):

```javascript
if (socio && dist.partnerProfit > 0) {
  await tx.payable.create({ data: {
    type: 'PARTNER_SHARE', status: 'PENDING', totalAmount: dist.partnerProfit, paidAmount: 0,
    description: `Ganancia socio venta ${vehicle.plate}`,
    vehicleId, thirdPartyId: socio.thirdPartyId, createdBy: userId,
  }});
}
if (socio && dist.partnerCommissionOwed > 0) {
  await tx.payable.create({ data: {
    type: 'RECEIVABLE', status: 'PENDING', totalAmount: dist.partnerCommissionOwed, paidAmount: 0,
    description: `Comisión socio venta ${vehicle.plate}`,
    vehicleId, thirdPartyId: socio.thirdPartyId, createdBy: userId,
  }});
}
```

Las reservas (`createBucketTransfer` con `dist.reinvestAmount`/`dist.taxAmount`) y `PROFIT_SHARE` (de `dist.investorRows`) ya reflejan la parte del fondo — no cambian de forma, solo de monto. Incluir `partnerProfit`/`partnerCommissionOwed`/`socioShare` en el `summary` retornado.

- [ ] **Step 4: Ejecutar toda la suite**

Run: `cd backend && node --test src/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/saleService.js backend/src/services/__tests__/saleService.dist.test.js
git commit -m "feat: registerSale crea PARTNER_SHARE + CxC de comisión del socio"
```

---

## Task 5: Reverso + total por pagar cubren `PARTNER_SHARE`

**Files:**
- Modify: `backend/src/services/saleService.js` (`cancelSale`, ~línea 568)
- Modify: `backend/src/services/payableService.js` (`getSummary`, filtros de tipo)
- Test: `backend/src/services/__tests__/saleService.dist.test.js` (o el de payableService si se crea)

**Interfaces:**
- Consumes: las CxP creadas en Task 4.

- [ ] **Step 1: Tests que fallan**
  - `cancelSale`: una venta con socio (que tiene `PARTNER_SHARE`) queda BLOQUEADA por el guard de CxP devengadas (extender el `type: { in: [...] }` a incluir `PARTNER_SHARE`).
  - `payableService.getSummary`: `PARTNER_SHARE` pendiente cuenta en `payables.total`.

- [ ] **Step 2: Ejecutar y ver fallar**
Run: `cd backend && node --test src/`

- [ ] **Step 3: Implementar**
  - `saleService.js:570`: cambiar `type: { in: ['COMMISSION', 'PROFIT_SHARE'] }` → `['COMMISSION', 'PROFIT_SHARE', 'PARTNER_SHARE']` (y actualizar el mensaje del error para mencionar "ganancia de socio").
  - `payableService.js` `getSummary` (los dos filtros): `type: { in: ['PAYABLE', 'COMMISSION', 'PROFIT_SHARE', 'PARTNER_SHARE'] }`.

- [ ] **Step 4: Ejecutar y ver pasar**
Run: `cd backend && node --test src/`

- [ ] **Step 5: Commit**
```bash
git add backend/src/services/saleService.js backend/src/services/payableService.js backend/src/services/__tests__/saleService.dist.test.js
git commit -m "fix: reverso y total por pagar cubren PARTNER_SHARE"
```

---

## Task 6: Frontend — validación de compra + card "el socio debe pagar $X"

**Files:**
- Modify: `frontend/src/components/vehicles/VehicleFormModal.jsx` (validación en vivo socio inversionista⟺100%)
- Modify: `frontend/src/components/treasury/SalePaymentModal.jsx` y/o la vista de venta del vehículo (card de comisión del socio)
- Modify: `frontend/src/pages/VehicleDetailPage.jsx` (mostrar ganancia del socio etiquetada como "Socio")

**Interfaces:**
- Consumes: el `summary` de la venta (con `partnerProfit`/`partnerCommissionOwed`/`socioShare`) y las CxP `PARTNER_SHARE`/`RECEIVABLE` del socio.

- [ ] **Step 1: Validación en la compra.** En `VehicleFormModal`, cuando se elige socio + aporte: si el socio está en el equipo de inversionistas (o es `owner-self`), exigir aporte = 100% del precio; si es externo, exigir < 100%. Mensaje claro inline (reusar el patrón de errores existente, ej. `errors.partner`). Cargar el `investor_team` (o exponer un endpoint/campo `isInvestor` del tercero) para saber si el socio es inversionista.

- [ ] **Step 2: Card "el socio [nombre] debe pagar $X".** En el modal/resumen de venta con socio, mostrar la comisión que el socio debe (`partnerCommissionOwed`) con su nombre — refleja la `RECEIVABLE`. Consistente con el estilo de las cards actuales.

- [ ] **Step 3: Ganancia del socio etiquetada.** En el detalle del vehículo, mostrar la CxP `PARTNER_SHARE` del socio etiquetada como **"Socio"** (no "Inversionista"). Verificar que la página de **Inversionistas NO** muestra `PARTNER_SHARE` (sigue filtrando `PROFIT_SHARE`).

- [ ] **Step 4: Build**
Run: `cd frontend && npm run build`
Expected: OK.

- [ ] **Step 5: Commit**
```bash
git add frontend/src
git commit -m "feat(ui): validación de socio en compra + card comisión del socio + ganancia etiquetada"
```

---

## Task 7: E2E

**Files:**
- Create: `tests/e2e/treasury/socio.spec.ts`

**Interfaces:**
- Consumes: el flujo completo compra-con-socio → venta.

- [ ] **Step 1: Escribir el e2e.** Comprar un carro con socio **externo** al 40%; venderlo; verificar: CxP `PARTNER_SHARE` del socio = su ganancia (sin reservas); CxC `RECEIVABLE` "Comisión socio" = su % de comisión; reservas y `PROFIT_SHARE` del fondo sobre la parte del fondo; la página de Inversionistas NO muestra al socio; `payables/summary` incluye la `PARTNER_SHARE`. Segundo caso: socio **inversionista al 100%** → reparto al resto del fondo = 0, reservas aplican. Caso de validación: inversionista con <100% al comprar → error.

- [ ] **Step 2: Ejecutar**
Run (con la app + DB de test; `migrate reset` limpio para aplicar la migración nueva): `npx playwright test tests/e2e/treasury/socio.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/treasury/socio.spec.ts tests/helpers
git commit -m "test(e2e): socio en la cascada de venta (externo, inversionista 100%, validación)"
```

---

## Self-Review (cobertura del spec)

- §2 detección + reglas → Task 2 (`resolveSocio`) ✔
- §2 cascada (casos A/B/sin socio) → Task 3 ✔
- §3 objetos de tesorería (PARTNER_SHARE + RECEIVABLE del socio + reservas parte fondo) → Task 3 (montos) + Task 4 (persistencia) ✔
- §4 firma de `calculateSaleDistribution` con socio → Task 3 ✔
- §5 flujo de venta + reverso → Task 4 + Task 5 ✔
- §6 UI (validación compra, card comisión socio, ganancia etiquetada, Inversionistas intacta) → Task 6 ✔
- §7 fuera de alcance → ninguna task toca capital del socio / socio parcial-inversionista / múltiples socios ✔
- §8 tests → cada task trae unit; Task 7 e2e ✔
- Enum + migración (§9 riesgo) → Task 1 ✔
- `PARTNER_SHARE` en total por pagar → Task 5 ✔

**Nota de ejecución:** Task 3 (cascada pura) es la de mayor riesgo financiero; ejecutarla completamente verde (con los cuadres de dinero de ambos casos) antes de tocar `registerSale` en Task 4.
