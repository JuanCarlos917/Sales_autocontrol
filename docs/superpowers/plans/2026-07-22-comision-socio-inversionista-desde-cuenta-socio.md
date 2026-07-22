# Comisión del socio inversionista 100% desde su cuenta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En ventas de socio inversionista 100%, mostrar la ganancia neta de comisión, depositar el pool de comisión en la cuenta del socio (`COMMISSION_RETURN`), y hacer que las comisiones de vendedores se paguen exclusivamente desde la cuenta del socio.

**Architecture:** Nuevo valor de enum `COMMISSION_RETURN` (PayableType + TransactionCategory). `financial.js` calcula la ganancia del inversionista neta de comisión. `saleService` crea la CxP `COMMISSION_RETURN` (= pool de comisión) en vez de la CxC "Comisión socio venta" cuando el socio es inversionista. `payableService` la categoriza (reusa FASE B → cuenta socio), la expone en un bucket `commissionReturn` y la cuenta en `getSummary`. `commissionService` expone el socio inversionista en el item para que el frontend restrinja el pago de comisiones a la cuenta del socio.

**Tech Stack:** Node.js + Express + Prisma/PostgreSQL (CommonJS backend); React + Vite (frontend); node:test (unit); Playwright (E2E).

## Global Constraints

- Backend CommonJS; frontend ES Modules; moneda COP en enteros.
- Aplica **solo a socio inversionista 100%** (`socio.isInvestor === true`, que garantiza `share === 1`). Socios externos parciales (`share < 1`) NO cambian.
- `ALTER TYPE ... ADD VALUE` va en su propia migración idempotente (`IF NOT EXISTS`), sin statements que usen el valor (convención del repo — ver `20260721120000_payable_type_capital_return`).
- El pago de `COMMISSION_RETURN` reusa el enrutamiento FASE B (egreso cuenta empresa + ingreso cuenta socio, misma categoría). El `PayablePayment` liga el egreso.
- El pago de una `COMMISSION` de vendedor puede salir de una cuenta SOCIO (el backend ya lo soporta); el frontend restringe el selector a esa cuenta para vehículos de socio inversionista.
- Sin ampliar el reverso simétrico. Sin manejar el caso "vendedor == socio del vehículo" (queda como error de guard FASE B).

---

### Task 1: Schema + migraciones — enum `COMMISSION_RETURN`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260722120000_payable_type_commission_return/migration.sql`
- Create: `backend/prisma/migrations/20260722120100_transaction_category_commission_return/migration.sql`

**Interfaces:**
- Produces: valores `COMMISSION_RETURN` disponibles en `PayableType` y `TransactionCategory` para las tareas siguientes.

- [ ] **Step 1: Editar el schema**

En `backend/prisma/schema.prisma`, en `enum PayableType` agregar `COMMISSION_RETURN` como último valor (después de `CAPITAL_RETURN`):

```prisma
enum PayableType {
  RECEIVABLE
  PAYABLE
  COMMISSION
  PROFIT_SHARE
  PARTNER_SHARE
  CAPITAL_RETURN
  COMMISSION_RETURN
}
```

En `enum TransactionCategory` agregar `COMMISSION_RETURN` (después de `CAPITAL_RETURN`):

```prisma
  CAPITAL_RETURN
  COMMISSION_RETURN
```

- [ ] **Step 2: Crear la migración de PayableType**

Crear `backend/prisma/migrations/20260722120000_payable_type_commission_return/migration.sql`:

```sql
-- AlterEnum
-- Idempotente (IF NOT EXISTS) por consistencia con las demás migraciones de enum.
ALTER TYPE "PayableType" ADD VALUE IF NOT EXISTS 'COMMISSION_RETURN';
```

- [ ] **Step 3: Crear la migración de TransactionCategory**

Crear `backend/prisma/migrations/20260722120100_transaction_category_commission_return/migration.sql`:

```sql
-- AlterEnum
-- Idempotente (IF NOT EXISTS) por consistencia con las demás migraciones de enum.
ALTER TYPE "TransactionCategory" ADD VALUE IF NOT EXISTS 'COMMISSION_RETURN';
```

- [ ] **Step 4: Generar cliente y validar**

Run (desde `backend/`): `npx prisma generate && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid` y cliente generado sin errores.

- [ ] **Step 5: Aplicar a la DB de desarrollo (si está disponible)**

Run (desde `backend/`): `npx prisma migrate deploy`
Expected: aplica las dos migraciones nuevas. Si la DB no está accesible en el entorno, dejar constancia en el reporte; se aplica en el deploy.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260722120000_payable_type_commission_return backend/prisma/migrations/20260722120100_transaction_category_commission_return
git commit -m "feat: enum COMMISSION_RETURN (PayableType + TransactionCategory) + migraciones"
```

---

### Task 2: `financial.js` — ganancia neta del inversionista

**Files:**
- Modify: `backend/src/utils/financial.js` (rama `socio.isInvestor` en `calculateSaleDistribution`)
- Test: `backend/src/utils/__tests__/financial.test.js`

**Interfaces:**
- Produces: para socio inversionista, `dist.partnerProfit = afterCommission − reinvest − tax` (neto de comisión). Consumido por `saleService` (Task 3, monto de `PARTNER_SHARE`).

- [ ] **Step 1: Actualizar el test existente del inversionista (falla)**

En `backend/src/utils/__tests__/financial.test.js`, en el test `'dist socio inversionista 100%: reservas sobre todo; reparto al fondo 0'`, cambiar la aserción de `partnerProfit` de bruta a neta y su comentario:

```js
  assert.equal(d.partnerProfit, 5_400_000);        // afterCommission (9M) − reservas (2.7M + 0.9M)
```

(Antes decía `6_400_000 // bruta − reservas`. El resto del test — `reinvestAmount 2_700_000`, `taxAmount 900_000`, `partnerCommissionOwed 1_000_000`, `profitToDistribute 0`, `investorRows.length 0` — se mantiene igual.)

- [ ] **Step 2: Agregar un test de no-regresión (inversionista sin comisión)**

En el mismo archivo, tras ese test, agregar:

```js
test('dist socio inversionista 100% SIN vendedores: ganancia neta == bruta (sin comisión)', () => {
  const d = calculateSaleDistribution(vBase, socioCfg,
    { sellers: [], investors: teamS, socio: { thirdPartyId: 'mama', share: 1, isInvestor: true } });
  assert.equal(d.commissionPool, 0);
  assert.equal(d.afterCommission, 10_000_000);
  assert.equal(d.partnerProfit, 6_000_000);        // 10M − 30% (3M) − 10% (1M)
});
```

- [ ] **Step 3: Correr los tests (fallan)**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: FAIL — hoy `partnerProfit` del inversionista es `grossProfit − reservas` (6.4M / 7M), no el neto.

- [ ] **Step 4: Implementar el cambio**

En `backend/src/utils/financial.js`, en `calculateSaleDistribution`, rama `} else if (socio.isInvestor) {`, cambiar SOLO la línea de `partnerProfit`:

```js
  } else if (socio.isInvestor) {
    // Inversionista 100%: reservas sobre todo; la ganancia se muestra NETA de
    // comisión (el pool de comisión se le deposita aparte como COMMISSION_RETURN
    // y él paga a los vendedores desde su cuenta). Fondo 0.
    reinvestAmount = roundCop((Number(cfg.reinvestPct) / 100) * afterCommission);
    taxAmount = roundCop((Number(cfg.taxPct) / 100) * afterCommission);
    partnerProfit = afterCommission - reinvestAmount - taxAmount;
    profitToDistribute = 0;
  }
```

(Único cambio real: `grossProfit` → `afterCommission` en `partnerProfit`.)

- [ ] **Step 5: Correr los tests (pasan)**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/financial.js backend/src/utils/__tests__/financial.test.js
git commit -m "feat: ganancia del socio inversionista neta de comisión (afterCommission)"
```

---

### Task 3: `saleService` — `COMMISSION_RETURN` para inversionista + guard `cancelSale`

**Files:**
- Modify: `backend/src/services/saleService.js`
- Test: `backend/src/services/__tests__/saleService.dist.test.js`
- Test: `backend/src/services/__tests__/saleService.cancel.test.js`

**Interfaces:**
- Consumes: `COMMISSION_RETURN` (Task 1); `dist.commissionPool`, `dist.partnerProfit` neto (Task 2); `socio.isInvestor` de `resolveSocio`.
- Produces: al vender con socio inversionista, se crea CxP `COMMISSION_RETURN = dist.commissionPool` (thirdParty = socio) y NO la CxC "Comisión socio venta". `cancelSale` bloquea si existe `COMMISSION_RETURN`.

- [ ] **Step 1: Escribir los tests de creación (fallan)**

En `backend/src/services/__tests__/saleService.dist.test.js`, tras los tests de socio externo/aporte, agregar el escenario inversionista 100% (`owner-self`, participation 0):

```js
// ── Escenario inversionista 100%: partnerId 'owner-self', participation 0 ──
// bruta = 30M − 20M = 10M; comisión 10% = 1M; afterCommission = 9M;
// reinvest 30% = 2.7M; tax 10% = 0.9M; ganancia NETA = 5.4M; capital = 20M.
test('registerSale: socio inversionista 100% → PARTNER_SHARE neto 5.4M + COMMISSION_RETURN 1M; SIN CxC "Comisión socio venta"', async () => {
  ctx = makeCtx({ vehicle: baseVehicle({
    partnerId: 'owner-self', participation: 0, purchasePrice: 20_000_000, partnerContribution: 20_000_000,
  }) });
  await saleService.registerSale('veh-1', {
    salePrice: 30_000_000,
    paymentType: 'CASH',
    cashPayment: { accountId: 'acc-cash', amount: 30_000_000, method: 'CASH' },
    buyerId: 'buyer-1',
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'u-1');

  const { payablesByType } = ctx.created;
  // Ganancia neta de comisión
  assert.equal(payablesByType.PARTNER_SHARE.length, 1);
  assert.equal(payablesByType.PARTNER_SHARE[0].totalAmount, 5_400_000);
  // Comisión depositada al socio
  const capRet = payablesByType.COMMISSION_RETURN || [];
  assert.equal(capRet.length, 1);
  assert.equal(capRet[0].totalAmount, 1_000_000);
  assert.equal(capRet[0].thirdPartyId, 'owner-self');
  assert.match(capRet[0].description, /comisi/i);
  // NO se crea la CxC "Comisión socio venta"
  const socioRec = (payablesByType.RECEIVABLE || []).find((p) => /Comisión socio/.test(p.description));
  assert.equal(socioRec, undefined);
});

test('registerSale: socio inversionista SIN vendedores → no crea COMMISSION_RETURN', async () => {
  ctx = makeCtx({ vehicle: baseVehicle({
    partnerId: 'owner-self', participation: 0, purchasePrice: 20_000_000, partnerContribution: 20_000_000,
  }) });
  await saleService.registerSale('veh-1', {
    salePrice: 30_000_000,
    paymentType: 'CASH',
    cashPayment: { accountId: 'acc-cash', amount: 30_000_000, method: 'CASH' },
    buyerId: 'buyer-1',
    participants: [],
  }, 'u-1');
  assert.equal((ctx.created.payablesByType.COMMISSION_RETURN || []).length, 0);
});
```

- [ ] **Step 2: Verificar que el socio externo sigue creando la CxC (test de guardia)**

En el mismo archivo, confirmar que existe el test `'registerSale: socio externo → PARTNER_SHARE 4M + CxC comisión 400k ...'` (ya presente). No modificarlo: es la regresión que garantiza que el socio parcial NO cambia. Si no existe, agregarlo espejando el patrón del socio externo.

- [ ] **Step 3: Correr (falla)**

Run: `cd backend && node --test src/services/__tests__/saleService.dist.test.js`
Expected: FAIL — hoy el inversionista crea la CxC "Comisión socio venta" y no crea `COMMISSION_RETURN`; `PARTNER_SHARE` es 6.4M (bruta) hasta Task 2 aplicada — con Task 2 ya es 5.4M pero sigue faltando `COMMISSION_RETURN` y sobra la CxC.

- [ ] **Step 4: Implementar en `saleService`**

En `backend/src/services/saleService.js`, reemplazar el bloque de la CxC "Comisión socio venta":

```js
      if (socio && dist.partnerCommissionOwed > 0) {
        await tx.payable.create({
          data: {
            type: 'RECEIVABLE',
            status: 'PENDING',
            totalAmount: dist.partnerCommissionOwed,
            paidAmount: 0,
            description: `Comisión socio venta ${vehicle.plate}`,
            vehicleId,
            thirdPartyId: socio.thirdPartyId,
            createdBy: userId,
          },
        });
      }
```

por (bifurca inversionista vs externo):

```js
      // Comisión del socio:
      //  - Inversionista 100%: el pool de comisión se DEPOSITA en su cuenta como
      //    CxP COMMISSION_RETURN (FASE B); él paga a los vendedores desde su cuenta.
      //  - Externo parcial: conserva el modelo actual (CxC "Comisión socio venta"
      //    que el fondo le cobra por su % de la comisión).
      if (socio && socio.isInvestor && dist.commissionPool > 0) {
        await tx.payable.create({
          data: {
            type: 'COMMISSION_RETURN',
            status: 'PENDING',
            totalAmount: dist.commissionPool,
            paidAmount: 0,
            description: `Comisión por pagar socio ${vehicle.plate}`,
            vehicleId,
            thirdPartyId: socio.thirdPartyId,
            createdBy: userId,
          },
        });
      } else if (socio && !socio.isInvestor && dist.partnerCommissionOwed > 0) {
        await tx.payable.create({
          data: {
            type: 'RECEIVABLE',
            status: 'PENDING',
            totalAmount: dist.partnerCommissionOwed,
            paidAmount: 0,
            description: `Comisión socio venta ${vehicle.plate}`,
            vehicleId,
            thirdPartyId: socio.thirdPartyId,
            createdBy: userId,
          },
        });
      }
```

- [ ] **Step 5: Correr (pasa)**

Run: `cd backend && node --test src/services/__tests__/saleService.dist.test.js`
Expected: PASS (nuevos casos + regresión socio externo).

- [ ] **Step 6: Test del guard de `cancelSale` (falla)**

En `backend/src/services/__tests__/saleService.cancel.test.js`, agregar (ajustando al patrón `baseVehicle([...payables])` usado por los tests vecinos):

```js
test('cancelSale: bloquea cuando hay CxP COMMISSION_RETURN devengada', async () => {
  ctx = {
    vehicle: baseVehicle([
      { id: 'cr-1', vehicleId: 'veh-1', type: 'COMMISSION_RETURN', paidAmount: 0, totalAmount: 1_000_000 },
    ]),
  };
  await assert.rejects(
    () => saleService.cancelSale('veh-1', 'u-1'),
    (e) => e.statusCode === 400 && /cancelar la venta/i.test(e.message),
  );
});
```

- [ ] **Step 7: Correr (falla)**

Run: `cd backend && node --test src/services/__tests__/saleService.cancel.test.js`
Expected: FAIL — el guard aún no incluye `COMMISSION_RETURN`.

- [ ] **Step 8: Agregar `COMMISSION_RETURN` al guard**

En `backend/src/services/saleService.js`, en `cancelSale`, en el `findMany` del guard de payables devengados, agregar `'COMMISSION_RETURN'`:

```js
  const commissionPayables = await prisma.payable.findMany({
    where: { vehicleId, type: { in: ['COMMISSION', 'PROFIT_SHARE', 'PARTNER_SHARE', 'CAPITAL_RETURN', 'COMMISSION_RETURN'] } },
  });
```

- [ ] **Step 9: Correr ambos (pasan)**

Run: `cd backend && node --test src/services/__tests__/saleService.dist.test.js src/services/__tests__/saleService.cancel.test.js`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/saleService.js backend/src/services/__tests__/saleService.dist.test.js backend/src/services/__tests__/saleService.cancel.test.js
git commit -m "feat: venta de socio inversionista crea COMMISSION_RETURN (no CxC) y cancelSale la bloquea"
```

---

### Task 4: `payableService` — categoría, bucket `commissionReturn` y `getSummary`

**Files:**
- Modify: `backend/src/services/payableService.js`
- Test: `backend/src/services/__tests__/payableService.socioPending.test.js`
- Test: `backend/src/services/__tests__/payableService.addPayment.socio.test.js`

**Interfaces:**
- Consumes: `COMMISSION_RETURN` (Task 1) y las CxP creadas en Task 3.
- Produces: `getSocioPending()` devuelve `{ capital, profit, commissionReturn, commission }`; `addPayment` categoriza `COMMISSION_RETURN` y enruta FASE B; `getSummary` lo cuenta en "por pagar".

- [ ] **Step 1: Test de `getSocioPending` (falla)**

En `backend/src/services/__tests__/payableService.socioPending.test.js`, agregar:

```js
test('incluye bucket commissionReturn con las CxP COMMISSION_RETURN pendientes', async () => {
  rows = [
    mkRow({ id: 'cr1', type: 'COMMISSION_RETURN', description: 'Comisión por pagar socio ABC', totalAmount: 1_000_000, paidAmount: 0 }),
    mkRow({ id: 'g1', type: 'PARTNER_SHARE', totalAmount: 5_400_000, paidAmount: 0 }),
  ];
  const out = await payableService.getSocioPending();
  assert.equal(out.commissionReturn.count, 1);
  assert.equal(out.commissionReturn.items[0].id, 'cr1');
  assert.equal(out.commissionReturn.total, 1_000_000);
});
```

- [ ] **Step 2: Correr (falla)**

Run: `cd backend && node --test src/services/__tests__/payableService.socioPending.test.js`
Expected: FAIL — `out.commissionReturn` es `undefined`.

- [ ] **Step 3: Agregar el bucket `commissionReturn` en `getSocioPending`**

En `backend/src/services/payableService.js`, en `getSocioPending`, agregar una consulta al `Promise.all` y el bucket al retorno. Reemplazar el `const [capitalRows, profitRows, commissionRows] = await Promise.all([...])` para incluir `commissionReturnRows` (entre profit y commission):

```js
  const [capitalRows, profitRows, commissionReturnRows, commissionRows] = await Promise.all([
    prisma.payable.findMany({
      where: { type: 'CAPITAL_RETURN', status: PENDING },
      include,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payable.findMany({
      where: { type: 'PARTNER_SHARE', status: PENDING },
      include,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payable.findMany({
      where: { type: 'COMMISSION_RETURN', status: PENDING },
      include,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payable.findMany({
      where: {
        type: 'RECEIVABLE',
        status: PENDING,
        description: { startsWith: SOCIO_COMMISSION_PREFIX },
      },
      include,
      orderBy: { createdAt: 'asc' },
    }),
  ]);
```

Y el retorno:

```js
  return {
    capital: toBucket(capitalRows),
    profit: toBucket(profitRows),
    commissionReturn: toBucket(commissionReturnRows),
    commission: toBucket(commissionRows),
  };
```

- [ ] **Step 4: Correr (pasa)**

Run: `cd backend && node --test src/services/__tests__/payableService.socioPending.test.js`
Expected: PASS (el caso previo de `commission` sigue verde: el fake `findMany` filtra por `type`, y `COMMISSION_RETURN` no interfiere con `RECEIVABLE`).

- [ ] **Step 5: Test de `addPayment` categoría (falla)**

En `backend/src/services/__tests__/payableService.addPayment.socio.test.js`, agregar (mismo patrón que el caso `CAPITAL_RETURN`):

```js
test('COMMISSION_RETURN a socio con cuenta → egreso empresa + ingreso socio, categoría COMMISSION_RETURN', async () => {
  resetCtx();
  ctx.payable.type = 'COMMISSION_RETURN';
  ctx.payable.description = 'Comisión por pagar socio ABC';
  const result = await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 1_000_000, date: '2026-07-22' }, 'user-1',
  );
  assert.equal(created.length, 2);
  const egreso = created.find((t) => t.type === 'EXPENSE');
  const ingreso = created.find((t) => t.type === 'INCOME');
  assert.equal(egreso.category, 'COMMISSION_RETURN');
  assert.equal(ingreso.category, 'COMMISSION_RETURN');
  assert.equal(ingreso.accountId, 'acc-socio');
  assert.equal(result.transaction.type, 'EXPENSE');
});
```

- [ ] **Step 6: Correr (falla)**

Run: `cd backend && node --test src/services/__tests__/payableService.addPayment.socio.test.js`
Expected: FAIL — hoy `COMMISSION_RETURN` cae en categoría `VEHICLE_PURCHASE` (tiene `vehicleId`).

- [ ] **Step 7: Mapear la categoría en `addPayment`**

En `backend/src/services/payableService.js`, en `addPayment`, junto a `isCapitalReturn` agregar:

```js
    const isCommissionReturn = payable.type === 'COMMISSION_RETURN';
```

Y en el ternario de `transactionCategory`, agregar la rama antes del fallback `VEHICLE_PURCHASE/OTHER_EXPENSE`:

```js
    const transactionCategory = isReceivable
      ? (payable.vehicleId ? 'VEHICLE_SALE_PARTIAL' : 'OTHER_INCOME')
      : isCommission
        ? 'COMMISSION'
        : isProfitShare
          ? 'PROFIT_SHARE'
          : isPartnerShare
            ? 'PARTNER_SHARE'
            : isCapitalReturn
              ? 'CAPITAL_RETURN'
              : isCommissionReturn
                ? 'COMMISSION_RETURN'
                : (payable.vehicleId ? 'VEHICLE_PURCHASE' : 'OTHER_EXPENSE');
```

- [ ] **Step 8: Correr (pasa)**

Run: `cd backend && node --test src/services/__tests__/payableService.addPayment.socio.test.js`
Expected: PASS.

- [ ] **Step 9: `getSummary` cuenta `COMMISSION_RETURN`**

En `backend/src/services/payableService.js`, en `getSummary`, agregar `'COMMISSION_RETURN'` a las DOS listas `type: { in: [...] }`:

```js
      type: { in: ['PAYABLE', 'COMMISSION', 'PROFIT_SHARE', 'PARTNER_SHARE', 'CAPITAL_RETURN', 'COMMISSION_RETURN'] },
```

(ambas apariciones dentro de `getSummary`).

- [ ] **Step 10: Correr la suite backend completa (sin regresión)**

Run: `cd backend && node --test`
Expected: PASS (244+ tests verdes, incluidos los nuevos).

- [ ] **Step 11: Commit**

```bash
git add backend/src/services/payableService.js backend/src/services/__tests__/payableService.socioPending.test.js backend/src/services/__tests__/payableService.addPayment.socio.test.js
git commit -m "feat: payableService — categoría COMMISSION_RETURN, bucket commissionReturn y conteo en getSummary"
```

---

### Task 5: `commissionService` — exponer el socio inversionista en el item

**Files:**
- Modify: `backend/src/services/commissionService.js` (`buildCommissionVehicleItem`, `listByVehicle`)
- Test: `backend/src/services/__tests__/commissionService.test.js`

**Interfaces:**
- Consumes: `resolveSocio(prismaOrTx, vehicle, cfg)` (existente) → `{ thirdPartyId, share, isInvestor } | null`.
- Produces: cada item de comisión incluye `socioInvestor: { thirdPartyId } | null`. Consumido por el frontend (Task 6) para restringir la cuenta de pago.

- [ ] **Step 1: Test de `buildCommissionVehicleItem` (falla)**

En `backend/src/services/__tests__/commissionService.test.js`, agregar:

```js
test('buildCommissionVehicleItem: incluye socioInvestor cuando se pasa', () => {
  const item = buildCommissionVehicleItem({
    vehicle, payables: [mkPayable()], bucketTransfers: [],
    socioInvestor: { thirdPartyId: 'owner-self' },
  });
  assert.deepEqual(item.socioInvestor, { thirdPartyId: 'owner-self' });
});

test('buildCommissionVehicleItem: socioInvestor null por defecto', () => {
  const item = buildCommissionVehicleItem({ vehicle, payables: [mkPayable()], bucketTransfers: [] });
  assert.equal(item.socioInvestor, null);
});
```

(`vehicle` y `mkPayable` ya existen en el archivo; reusar los del harness.)

- [ ] **Step 2: Correr (falla)**

Run: `cd backend && node --test src/services/__tests__/commissionService.test.js`
Expected: FAIL — `item.socioInvestor` es `undefined`.

- [ ] **Step 3: Aceptar y exponer `socioInvestor` en `buildCommissionVehicleItem`**

En `backend/src/services/commissionService.js`, cambiar la firma y el retorno de `buildCommissionVehicleItem`:

```js
function buildCommissionVehicleItem({ vehicle, payables, bucketTransfers, socioInvestor = null }) {
```

y agregar al objeto retornado (junto a `roles`, `buckets`, `hasPending`):

```js
    socioInvestor,
```

- [ ] **Step 4: Correr (pasa)**

Run: `cd backend && node --test src/services/__tests__/commissionService.test.js`
Expected: PASS.

- [ ] **Step 5: Resolver y pasar `socioInvestor` desde `listByVehicle`**

En `backend/src/services/commissionService.js`, en `listByVehicle`, cargar la config una vez y resolver el socio por vehículo. Antes del `const items = [...byVehicle.values()].map(...)`, cargar cfg de forma segura:

```js
  // Config para resolver el socio inversionista de cada vehículo (no toca DB en
  // resolveSocio; degrada a null si los settings de comisiones no existen).
  let socioCfg = null;
  try {
    socioCfg = await loadCommissionConfig(prismaOrTx);
  } catch (err) {
    if (!(err instanceof AppError && err.message.startsWith('Settings de comisiones faltantes'))) throw err;
  }
```

Y reemplazar el `.map` que arma los items por uno asíncrono que resuelve el socio:

```js
  const items = await Promise.all(
    [...byVehicle.values()].map(async ({ vehicle, payables: ps }) => {
      let socioInvestor = null;
      if (socioCfg) {
        try {
          const socio = await resolveSocio(prismaOrTx, vehicle, socioCfg);
          if (socio && socio.isInvestor) socioInvestor = { thirdPartyId: socio.thirdPartyId };
        } catch { socioInvestor = null; } // invariantes ya validadas al vender
      }
      return buildCommissionVehicleItem({
        vehicle, payables: ps, bucketTransfers: bucketByVehicle.get(vehicle.id) || [], socioInvestor,
      });
    }),
  );
```

(`vehicle` incluido en la query ya trae `partnerId` y `participation`, que es lo único que usa `resolveSocio`.)

- [ ] **Step 6: Correr la suite backend completa**

Run: `cd backend && node --test`
Expected: PASS (sin regresión).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/commissionService.js backend/src/services/__tests__/commissionService.test.js
git commit -m "feat: commissionService expone socioInvestor en el item de comisión"
```

---

### Task 6: Frontend — pago de comisiones solo desde la cuenta del socio + widget

**Files:**
- Modify: `frontend/src/components/treasury/PaymentModal.jsx`
- Modify: `frontend/src/pages/treasury/CommissionsPage.jsx`
- Modify: `frontend/src/components/treasury/SocioPendingWidget.jsx`

**Interfaces:**
- Consumes: `item.socioInvestor` (Task 5) en la página de comisiones; `data.commissionReturn` (Task 4) en el widget.
- Produces: al pagar una comisión de vehículo de socio inversionista, el selector ofrece SOLO la cuenta del socio; el widget muestra la sección "Comisión por pagar".

- [ ] **Step 1: `PaymentModal` — nueva prop `originSocioThirdPartyId`**

En `frontend/src/components/treasury/PaymentModal.jsx`, agregar la prop en la firma:

```jsx
export default function PaymentModal({
  isOpen,
  onClose,
  onSubmit,
  title = 'Registrar Pago',
  type = 'expense',
  totalAmount = 0,
  paidAmount = 0,
  defaultDescription = '',
  loading = false,
  thirdPartyId = null,
  originSocioThirdPartyId = null,
}) {
```

Y cambiar el cálculo de `originAccounts` (reemplazar la línea actual `const originAccounts = socioDestAccount ? ... : accounts;`) por:

```jsx
  // Restricción de origen: pagar una comisión de un vehículo de socio inversionista
  // solo puede salir de la cuenta SOCIO de ese tercero.
  const restrictedOrigin = originSocioThirdPartyId
    ? accounts.filter((a) => a.type === 'SOCIO' && a.thirdPartyId === originSocioThirdPartyId && a.isActive)
    : null;
  const originAccounts = restrictedOrigin
    ? restrictedOrigin
    : (socioDestAccount ? accounts.filter((a) => a.type !== 'SOCIO') : accounts);
```

- [ ] **Step 2: `PaymentModal` — autoseleccionar cuando es la única opción**

En el `loadAccounts` de `PaymentModal.jsx`, tras `setAccounts(...)`, la auto-selección actual usa `data[0]`. Para la cuenta restringida, autoseleccionarla. Reemplazar el cuerpo de `loadAccounts` por:

```jsx
  const loadAccounts = async () => {
    try {
      const { data } = await accountsApi.getAll();
      const active = data.filter((a) => a.isActive);
      setAccounts(active);
      const preferred = originSocioThirdPartyId
        ? active.find((a) => a.type === 'SOCIO' && a.thirdPartyId === originSocioThirdPartyId)
        : active[0];
      if (preferred) {
        setForm((f) => (f.accountId ? f : { ...f, accountId: preferred.id }));
      }
    } catch (err) {
      console.error('Error loading accounts:', err);
    }
  };
```

- [ ] **Step 3: `CommissionsPage` — pasar la restricción al modal**

En `frontend/src/pages/treasury/CommissionsPage.jsx`, en el `<PaymentModal .../>` del "Pago por rol", agregar la prop (usa el `socioInvestor` del item; `undefined` para vehículos no-inversionistas ⇒ comportamiento normal):

```jsx
        <PaymentModal
          isOpen={!!paying}
          onClose={() => setPaying(null)}
          onSubmit={handlePaymentSubmit}
          title={`Pagar comisión ${ROLE_LABEL[paying.role.role] || paying.role.role} — ${paying.item.vehicle.plate}`}
          type="expense"
          totalAmount={paying.role.total}
          paidAmount={paying.role.paid}
          defaultDescription={`Comisión venta ${paying.item.vehicle.plate} — ${paying.role.role}`}
          originSocioThirdPartyId={paying.item.socioInvestor?.thirdPartyId || null}
          loading={processing}
        />
```

- [ ] **Step 4: `SocioPendingWidget` — sección "Comisión por pagar"**

En `frontend/src/components/treasury/SocioPendingWidget.jsx`:

Cambiar el destructuring y el guard de auto-ocultar:

```jsx
  if (!data) return null;
  const { capital, profit, commissionReturn, commission } = data;
  if (capital.count === 0 && profit.count === 0 && commissionReturn.count === 0 && commission.count === 0) return null;
```

Cambiar `isExpense` para incluir el nuevo kind:

```jsx
  const isExpense = selected?.kind === 'profit' || selected?.kind === 'capital' || selected?.kind === 'commissionReturn';
```

Agregar la sección "Comisión por pagar" entre "Ganancia por pagar" y "Comisión por cobrar":

```jsx
      {commissionReturn.count > 0 && (
        <div className={(capital.count > 0 || profit.count > 0) ? 'mt-5' : ''}>
          <Section
            title="Comisión por pagar"
            icon={<ArrowUpRight className="w-4 h-4 text-red-400" />}
            bucket={commissionReturn}
            accent="red"
            onRow={(item) => setSelected({ item, kind: 'commissionReturn' })}
          />
        </div>
      )}
```

Y actualizar el margen superior de la sección "Comisión por cobrar" para considerar también `commissionReturn`:

```jsx
      {commission.count > 0 && (
        <div className={(capital.count > 0 || profit.count > 0 || commissionReturn.count > 0) ? 'mt-5' : ''}>
          <Section
            title="Comisión por cobrar"
            icon={<ArrowDownLeft className="w-4 h-4 text-green-400" />}
            bucket={commission}
            accent="green"
            onRow={(item) => setSelected({ item, kind: 'commission' })}
          />
        </div>
      )}
```

Y en el `PaymentModal` del widget, cubrir el título y descripción del nuevo kind (reemplazar el `title` y `defaultDescription`):

```jsx
          title={
            selected.kind === 'capital'
              ? 'Devolver capital al socio'
              : selected.kind === 'commissionReturn'
                ? 'Depositar comisión al socio'
                : isExpense ? 'Pagar ganancia socio' : 'Cobrar comisión socio'
          }
          type={isExpense ? 'expense' : 'income'}
          totalAmount={selected.item.totalAmount}
          paidAmount={selected.item.paidAmount}
          defaultDescription={
            selected.kind === 'capital'
              ? `Devolución de capital ${selected.item.vehicle?.plate || ''}`.trim()
              : selected.kind === 'commissionReturn'
                ? `Comisión por pagar ${selected.item.vehicle?.plate || ''}`.trim()
                : isExpense
                  ? `Ganancia socio ${selected.item.vehicle?.plate || ''}`.trim()
                  : `Comisión socio ${selected.item.vehicle?.plate || ''}`.trim()
          }
          thirdPartyId={isExpense ? selected.item.thirdParty?.id : null}
          loading={processing}
```

(La sección "Comisión por pagar" es egreso a la cuenta del socio → usa FASE B igual que capital/ganancia: `thirdPartyId` del socio activa el enrutamiento.)

- [ ] **Step 5: Build**

Run: `cd frontend && npm run build`
Expected: build OK, sin errores.

- [ ] **Step 6: Verificación manual (con backend+frontend levantados por el usuario)**

- Widget "Socios: pendientes" muestra la sección "Comisión por pagar" para vehículos de socio inversionista; tocar una fila abre "Depositar comisión al socio" y el dinero entra a la cuenta del socio.
- En la página de Comisiones, al dar "Pagar" a un vehículo de socio inversionista, el selector de cuenta ofrece SOLO la cuenta del socio.
- Vehículos sin socio inversionista: el selector sigue ofreciendo todas las cuentas.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/treasury/PaymentModal.jsx frontend/src/pages/treasury/CommissionsPage.jsx frontend/src/components/treasury/SocioPendingWidget.jsx
git commit -m "feat: comisiones de socio inversionista se pagan solo desde su cuenta; widget 'Comisión por pagar'"
```

---

### Task 7: E2E — round-trip inversionista 100% con comisión desde la cuenta del socio

**Files:**
- Modify: `tests/helpers/api.ts` (campo `commissionReturn` en el tipo de `apiGetSocioPending`)
- Modify: `tests/e2e/treasury/socio.spec.ts` (test de round-trip)

**Interfaces:**
- Consumes: `GET /api/payables/socio-pending` (ahora con `commissionReturn`), helpers existentes (`buyVehicleWithSocio`, `sellSocioVehicleCash`, `apiGetSocioPending`, `apiGetAccount`, `apiRequestRaw`, `apiListPayables`) y `TEST_SEED_IDS`.

- [ ] **Step 1: Extender el tipo del helper**

En `tests/helpers/api.ts`, en el tipo de retorno de `apiGetSocioPending`, agregar el bucket `commissionReturn`:

```ts
export async function apiGetSocioPending(
  token: string,
): Promise<{
  capital: SocioPendingBucket;
  profit: SocioPendingBucket;
  commissionReturn: SocioPendingBucket;
  commission: SocioPendingBucket;
}> {
  return getJson('/payables/socio-pending', token);
}
```

- [ ] **Step 2: Escribir el test de round-trip**

En `tests/e2e/treasury/socio.spec.ts`, agregar (reutiliza los helpers de venta con socio ya usados por los otros tests del archivo; ajustar nombres a los reales del archivo si difieren):

```ts
  test('Modelo: inversionista 100% — comisión se deposita y se paga desde la cuenta del socio', async () => {
    const token = await apiPinLogin();
    // Inversionista 100% (owner-self, participation 0). Compra 20M, venta 30M.
    const v = await buyVehicleWithSocio(token, plate('CR'), { partnerId: 'owner-self', participation: 0 });
    await sellSocioVehicleCash(token, v.id, { participants: [{ thirdPartyId: 'test-tp-seller', role: 'CERRADOR', sharePct: 100 }] });

    const pend = await apiGetSocioPending(token);
    const cap = pend.capital.items.find((it) => it.vehicleId === v.id);
    const prof = pend.profit.items.find((it) => it.vehicleId === v.id);
    const comm = pend.commissionReturn.items.find((it) => it.vehicleId === v.id);
    expect(cap).toBeTruthy();
    expect(prof).toBeTruthy();
    expect(comm).toBeTruthy();

    const socioAcc0 = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
    const before = Number(socioAcc0.currentBalance);

    // Depositar capital + ganancia + comisión a la cuenta del socio (FASE B desde caja empresa).
    for (const it of [cap!, prof!, comm!]) {
      const r = await apiRequestRaw('POST', `/payables/${it.id}/payments`, token, {
        accountId: TEST_SEED_IDS.accountCash, amount: it.pending, date: '2026-07-22',
      });
      expect(r.status).toBe(201);
    }
    const commTx = comm!.pending;
    const socioAcc1 = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
    expect(Number(socioAcc1.currentBalance)).toBe(before + cap!.pending + prof!.pending + commTx);

    // Pagar la comisión del vendedor DESDE la cuenta del socio.
    const sellerPayables = await apiListPayables(token, { type: 'COMMISSION', vehicleId: v.id });
    const sellerTotal = sellerPayables.reduce((s, p) => s + (Number(p.totalAmount) - Number(p.paidAmount)), 0);
    expect(sellerTotal).toBe(commTx); // el pool depositado == lo que se paga a vendedores
    for (const p of sellerPayables) {
      const pending = Number(p.totalAmount) - Number(p.paidAmount);
      if (pending <= 0) continue;
      const r = await apiRequestRaw('POST', `/payables/${p.id}/payments`, token, {
        accountId: TEST_SEED_IDS.partnerAccount, amount: pending, date: '2026-07-22',
      });
      expect(r.status).toBe(201);
    }

    // La comisión salió de la cuenta del socio → neto = capital + ganancia.
    const socioAcc2 = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
    expect(Number(socioAcc2.currentBalance)).toBe(before + cap!.pending + prof!.pending);

    // Ya no queda comisión por depositar.
    const pend2 = await apiGetSocioPending(token);
    expect(pend2.commissionReturn.items.some((it) => it.vehicleId === v.id)).toBe(false);
  });
```

(Nota para el implementador: verificar contra `tests/global-setup.ts` los nombres reales de `TEST_SEED_IDS.partnerAccount` / `accountCash` y del vendedor sembrado; `buyVehicleWithSocio`/`sellSocioVehicleCash` deben aceptar `owner-self` como inversionista 100% — el spec `socio.spec.ts` ya lo usa. Si `sellSocioVehicleCash` no acepta `participants`, usar el helper de venta que sí los acepte o `apiRequestRaw` directo al endpoint de venta.)

- [ ] **Step 3: Correr el test targeted**

Run (desde la raíz): `npm run test:e2e -- tests/e2e/treasury/socio.spec.ts -g "inversionista 100%"`
Expected: PASS.

- [ ] **Step 4: Correr el spec completo (regresión)**

Run: `npm run test:e2e -- tests/e2e/treasury/socio.spec.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/api.ts tests/e2e/treasury/socio.spec.ts
git commit -m "test(e2e): inversionista 100% — comisión depositada y pagada desde la cuenta del socio"
```

---

## Self-Review

**1. Spec coverage:**
- §"ganancia neta" → Task 2 (financial.js) + Task 3 (PARTNER_SHARE usa el neto).
- §"enum COMMISSION_RETURN + migraciones" → Task 1.
- §"saleService crea COMMISSION_RETURN, no CxC; guard cancelSale" → Task 3.
- §"payableService: categoría, bucket commissionReturn, getSummary" → Task 4.
- §"commissionService expone socio inversionista" → Task 5.
- §"PaymentModal restringe a cuenta socio; CommissionsPage pasa prop; widget 'Comisión por pagar'" → Task 6.
- §"socios parciales sin cambio" → Task 3 (rama `!isInvestor` conserva la CxC) + test de regresión socio externo.
- §"tests unit + E2E round-trip" → Tasks 2–5 (unit) + Task 7 (E2E).
- §"fuera de alcance: reverso, vendedor==socio" → no se implementan (documentado).

**2. Placeholder scan:** sin TBD/TODO. Las notas condicionales (ajustar nombres reales de `TEST_SEED_IDS`/helpers de venta contra el seed) son instrucciones legítimas de reconciliación con código de tests no mostrado, no placeholders de lógica.

**3. Type/consistency:** `COMMISSION_RETURN` idéntico en enum (T1), creación (T3), categoría/bucket/summary (T4) y E2E (T7). El contrato de `getSocioPending` pasa de `{ capital, profit, commission }` a `{ capital, profit, commissionReturn, commission }` consistente entre service (T4), widget (T6) y helper E2E (T7). La prop `originSocioThirdPartyId` (T6, PaymentModal) coincide con lo que pasa `CommissionsPage` (T6) desde `item.socioInvestor.thirdPartyId` (T5). `socioInvestor` con forma `{ thirdPartyId }` es consistente entre T5 (producción) y T6 (consumo).
