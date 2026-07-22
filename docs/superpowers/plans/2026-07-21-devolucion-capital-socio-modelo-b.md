# Devolución de capital al socio (Modelo B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el ciclo de capital del socio: al vender, crear una CxP dedicada `CAPITAL_RETURN` (= aporte del socio) que, pagada, devuelve su capital a su cuenta; el cobro de la venta va siempre a una cuenta de empresa.

**Architecture:** Nuevo valor de enum `CAPITAL_RETURN` (PayableType + TransactionCategory). `saleService` crea la CxP al registrar la venta. `payableService` la categoriza al pagar (reusa el enrutamiento FASE B a la cuenta socio), la expone en un bucket `capital` de `getSocioPending`, y la cuenta en `getSummary`. El frontend agrega una sección "Capital por devolver" al widget y oculta cuentas SOCIO del cobro de venta.

**Tech Stack:** Node.js + Express + Prisma/PostgreSQL (CommonJS backend); React + Vite (frontend); node:test (unit); Playwright (E2E).

## Global Constraints

- Backend CommonJS; frontend ES Modules; moneda COP en enteros.
- Capital a devolver = `Number(vehicle.partnerContribution)` (lo que salió de la cuenta SOCIO en la compra). Se crea la CxP solo si `socio && partnerContribution > 0`.
- Tipo/categoría nuevos: `CAPITAL_RETURN` en `PayableType` y `TransactionCategory`.
- `ALTER TYPE ... ADD VALUE` va en su propia migración, sin statements que USEN el valor (convención del repo: una migración por enum — ver `20260717120000_payable_type_partner_share` y `20260717123000_transaction_category_partner_share`).
- El pago de `CAPITAL_RETURN` reusa el enrutamiento FASE B (egreso cuenta empresa + ingreso cuenta socio, misma categoría). El `PayablePayment` liga el egreso.
- El cobro de la venta nunca cae en una cuenta SOCIO.
- Sin ampliar el reverso simétrico (follow-up #2 de FASE B).

---

### Task 1: Schema + migraciones — enum `CAPITAL_RETURN`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260721120000_payable_type_capital_return/migration.sql`
- Create: `backend/prisma/migrations/20260721120100_transaction_category_capital_return/migration.sql`

**Interfaces:**
- Produces: valores `CAPITAL_RETURN` disponibles en `PayableType` y `TransactionCategory` para las tareas siguientes.

- [ ] **Step 1: Editar el schema**

En `backend/prisma/schema.prisma`, en `enum PayableType` agregar `CAPITAL_RETURN` como último valor:

```prisma
enum PayableType {
  RECEIVABLE
  PAYABLE
  COMMISSION
  PROFIT_SHARE
  PARTNER_SHARE
  CAPITAL_RETURN
}
```

En `enum TransactionCategory` agregar `CAPITAL_RETURN` (después de `CAPITAL_CONTRIBUTION`):

```prisma
  CAPITAL_CONTRIBUTION
  CAPITAL_RETURN
```

- [ ] **Step 2: Crear la migración de PayableType**

Crear `backend/prisma/migrations/20260721120000_payable_type_capital_return/migration.sql` con:

```sql
-- AlterEnum
ALTER TYPE "PayableType" ADD VALUE 'CAPITAL_RETURN';
```

- [ ] **Step 3: Crear la migración de TransactionCategory**

Crear `backend/prisma/migrations/20260721120100_transaction_category_capital_return/migration.sql` con:

```sql
-- AlterEnum
ALTER TYPE "TransactionCategory" ADD VALUE 'CAPITAL_RETURN';
```

- [ ] **Step 4: Generar cliente y validar**

Run (desde `backend/`): `npx prisma generate && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid` y cliente generado sin errores.

- [ ] **Step 5: Aplicar a la DB de desarrollo (si está disponible)**

Run (desde `backend/`): `npx prisma migrate deploy`
Expected: aplica las dos migraciones nuevas ("2 migrations applied" o equivalente). Si la DB no está accesible en el entorno del subagente, dejar constancia en el reporte; se aplica en el deploy.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260721120000_payable_type_capital_return backend/prisma/migrations/20260721120100_transaction_category_capital_return
git commit -m "feat: enum CAPITAL_RETURN (PayableType + TransactionCategory) + migraciones"
```

---

### Task 2: `saleService` — crear la CxP `CAPITAL_RETURN` + guard de `cancelSale`

**Files:**
- Modify: `backend/src/services/saleService.js`
- Test: `backend/src/services/__tests__/saleService.dist.test.js` (agregar caso)
- Test: `backend/src/services/__tests__/saleService.cancel.test.js` (agregar caso)

**Interfaces:**
- Consumes: `CAPITAL_RETURN` de `PayableType` (Task 1).
- Produces: al registrar una venta con `socio && vehicle.partnerContribution > 0`, se crea una CxP `type: 'CAPITAL_RETURN'` = `partnerContribution`. `cancelSale` bloquea si existe.

- [ ] **Step 1: Escribir el test de creación (falla)**

En `backend/src/services/__tests__/saleService.dist.test.js`, agregar tras el test de socio externo:

```js
test('registerSale: socio externo con aporte → CxP CAPITAL_RETURN = partnerContribution', async () => {
  ctx = makeCtx({ vehicle: baseVehicle({
    partnerId: 'ext', participation: 0.6, purchasePrice: 20_000_000, partnerContribution: 8_000_000,
  }) });
  await saleService.registerSale('veh-1', {
    salePrice: 30_000_000,
    paymentType: 'CASH',
    cashPayment: { accountId: 'acc-cash', amount: 30_000_000, method: 'CASH' },
    buyerId: 'buyer-1',
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'u-1');

  const cap = ctx.created.payablesByType.CAPITAL_RETURN || [];
  assert.equal(cap.length, 1);
  assert.equal(cap[0].totalAmount, 8_000_000);
  assert.equal(cap[0].thirdPartyId, 'ext');
  assert.match(cap[0].description, /capital/i);
});

test('registerSale: socio SIN aporte (partnerContribution 0) → no crea CAPITAL_RETURN', async () => {
  ctx = makeCtx({ vehicle: baseVehicle({
    partnerId: 'ext', participation: 0.6, purchasePrice: 20_000_000, partnerContribution: 0,
  }) });
  await saleService.registerSale('veh-1', {
    salePrice: 30_000_000,
    paymentType: 'CASH',
    cashPayment: { accountId: 'acc-cash', amount: 30_000_000, method: 'CASH' },
    buyerId: 'buyer-1',
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'u-1');
  assert.equal((ctx.created.payablesByType.CAPITAL_RETURN || []).length, 0);
});
```

- [ ] **Step 2: Correr el test (falla)**

Run: `cd backend && node --test src/services/__tests__/saleService.dist.test.js`
Expected: FAIL — hoy no se crea ninguna CxP `CAPITAL_RETURN`.

- [ ] **Step 3: Crear la CxP en `saleService`**

En `backend/src/services/saleService.js`, junto a la creación de la CxP `PARTNER_SHARE` (dentro de la `$transaction`, después del bloque `if (socio && dist.partnerProfit > 0) {...}`), agregar:

```js
      // Devolución de capital al socio (Modelo B): lo que aportó en la compra
      // (partnerContribution) se le devuelve como CxP dedicada; al pagarla, el
      // enrutamiento FASE B la deposita en su cuenta SOCIO.
      const partnerCapital = Number(vehicle.partnerContribution || 0);
      if (socio && partnerCapital > 0) {
        await tx.payable.create({
          data: {
            type: 'CAPITAL_RETURN',
            status: 'PENDING',
            totalAmount: partnerCapital,
            paidAmount: 0,
            description: `Devolución de capital socio ${vehicle.plate}`,
            vehicleId,
            thirdPartyId: socio.thirdPartyId,
            createdBy: userId,
          },
        });
      }
```

- [ ] **Step 4: Correr el test (pasa)**

Run: `cd backend && node --test src/services/__tests__/saleService.dist.test.js`
Expected: PASS (todos los casos, incluidos los nuevos).

- [ ] **Step 5: Test del guard de `cancelSale` (falla)**

En `backend/src/services/__tests__/saleService.cancel.test.js`, agregar un caso que fije un payable `CAPITAL_RETURN` y espere el bloqueo. Siguiendo el patrón del archivo (fija `ctx.vehicle.payables` y espera que `cancelSale` lance):

```js
test('cancelSale: bloquea cuando hay CxP CAPITAL_RETURN devengada', async () => {
  ctx = {
    vehicle: baseVehicle([
      { id: 'cap-1', vehicleId: 'veh-1', type: 'CAPITAL_RETURN', paidAmount: 0, totalAmount: 8_000_000 },
    ]),
  };
  await assert.rejects(
    () => saleService.cancelSale('veh-1', 'u-1'),
    (e) => e.statusCode === 400 && /cancelar la venta/i.test(e.message),
  );
});
```

(Si la firma exacta de `cancelSale`/`baseVehicle` en ese archivo difiere, ajustar al patrón ya usado por los tests vecinos de ese mismo archivo.)

- [ ] **Step 6: Correr el test (falla)**

Run: `cd backend && node --test src/services/__tests__/saleService.cancel.test.js`
Expected: FAIL — el guard aún no incluye `CAPITAL_RETURN`.

- [ ] **Step 7: Agregar `CAPITAL_RETURN` al guard**

En `backend/src/services/saleService.js`, en `cancelSale`, en el `findMany` del guard de payables devengados, agregar `'CAPITAL_RETURN'` a la lista:

```js
  const commissionPayables = await prisma.payable.findMany({
    where: { vehicleId, type: { in: ['COMMISSION', 'PROFIT_SHARE', 'PARTNER_SHARE', 'CAPITAL_RETURN'] } },
  });
```

- [ ] **Step 8: Correr ambos tests (pasan)**

Run: `cd backend && node --test src/services/__tests__/saleService.dist.test.js src/services/__tests__/saleService.cancel.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/saleService.js backend/src/services/__tests__/saleService.dist.test.js backend/src/services/__tests__/saleService.cancel.test.js
git commit -m "feat: la venta crea CxP CAPITAL_RETURN (= aporte del socio) y cancelSale la bloquea"
```

---

### Task 3: `payableService` — categoría, bucket `capital` y `getSummary`

**Files:**
- Modify: `backend/src/services/payableService.js`
- Test: `backend/src/services/__tests__/payableService.socioPending.test.js` (agregar caso `capital`)
- Test: `backend/src/services/__tests__/payableService.addPayment.socio.test.js` (agregar caso CAPITAL_RETURN)

**Interfaces:**
- Consumes: `CAPITAL_RETURN` (Task 1) y las CxP creadas en Task 2.
- Produces: `getSocioPending()` devuelve `{ capital, profit, commission }`; `addPayment` categoriza `CAPITAL_RETURN`; `getSummary` lo cuenta en "por pagar".

- [ ] **Step 1: Test de `getSocioPending` (falla)**

En `backend/src/services/__tests__/payableService.socioPending.test.js`, agregar un caso que fije un payable `CAPITAL_RETURN` pendiente y afirme que aparece en `out.capital`:

```js
test('incluye bucket capital con las CxP CAPITAL_RETURN pendientes', async () => {
  rows = [
    mkRow({ id: 'cap1', type: 'CAPITAL_RETURN', description: 'Devolución de capital socio ABC', totalAmount: 30_000_000, paidAmount: 0 }),
    mkRow({ id: 'g1', type: 'PARTNER_SHARE', totalAmount: 12_800_000, paidAmount: 0 }),
  ];
  const out = await payableService.getSocioPending();
  assert.equal(out.capital.count, 1);
  assert.equal(out.capital.items[0].id, 'cap1');
  assert.equal(out.capital.total, 30_000_000);
});
```

(El fake `payable.findMany` del archivo ya filtra por `type` y `status`; `CAPITAL_RETURN` se filtra por `type` sin prefijo, igual que `PARTNER_SHARE`.)

- [ ] **Step 2: Correr (falla)**

Run: `cd backend && node --test src/services/__tests__/payableService.socioPending.test.js`
Expected: FAIL — `out.capital` es `undefined`.

- [ ] **Step 3: Agregar el bucket `capital` en `getSocioPending`**

En `backend/src/services/payableService.js`, en `getSocioPending`, agregar una tercera consulta al `Promise.all` y el bucket al retorno. Reemplazar el `const [profitRows, commissionRows] = await Promise.all([...])` para incluir `capitalRows`:

```js
  const [capitalRows, profitRows, commissionRows] = await Promise.all([
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
  return { capital: toBucket(capitalRows), profit: toBucket(profitRows), commission: toBucket(commissionRows) };
```

- [ ] **Step 4: Correr (pasa)**

Run: `cd backend && node --test src/services/__tests__/payableService.socioPending.test.js`
Expected: PASS.

- [ ] **Step 5: Test de `addPayment` categoría (falla)**

En `backend/src/services/__tests__/payableService.addPayment.socio.test.js`, agregar un caso: pagar una CxP `CAPITAL_RETURN` de un socio con cuenta SOCIO → dos asientos con categoría `CAPITAL_RETURN`. Reusar el harness del archivo (que ya stubbea prisma/txLocks/treasuryAudit/accountService). Basado en el `resetCtx` existente, fijar `ctx.payable.type = 'CAPITAL_RETURN'`:

```js
test('CAPITAL_RETURN a socio con cuenta → egreso empresa + ingreso socio, categoría CAPITAL_RETURN', async () => {
  resetCtx();
  ctx.payable.type = 'CAPITAL_RETURN';
  ctx.payable.description = 'Devolución de capital socio ABC';
  const result = await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 6_400_000, date: '2026-07-21' }, 'user-1',
  );
  assert.equal(created.length, 2);
  const egreso = created.find((t) => t.type === 'EXPENSE');
  const ingreso = created.find((t) => t.type === 'INCOME');
  assert.equal(egreso.category, 'CAPITAL_RETURN');
  assert.equal(ingreso.category, 'CAPITAL_RETURN');
  assert.equal(ingreso.accountId, 'acc-socio');
  assert.equal(result.transaction.type, 'EXPENSE');
});
```

- [ ] **Step 6: Correr (falla)**

Run: `cd backend && node --test src/services/__tests__/payableService.addPayment.socio.test.js`
Expected: FAIL — hoy `CAPITAL_RETURN` cae en categoría `VEHICLE_PURCHASE` (tiene `vehicleId`).

- [ ] **Step 7: Mapear la categoría en `addPayment`**

En `backend/src/services/payableService.js`, en `addPayment`, agregar el flag y la rama de categoría. Junto a `isPartnerShare`:

```js
    const isCapitalReturn = payable.type === 'CAPITAL_RETURN';
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
              : (payable.vehicleId ? 'VEHICLE_PURCHASE' : 'OTHER_EXPENSE');
```

- [ ] **Step 8: Correr (pasa)**

Run: `cd backend && node --test src/services/__tests__/payableService.addPayment.socio.test.js`
Expected: PASS.

- [ ] **Step 9: `getSummary` cuenta CAPITAL_RETURN**

En `backend/src/services/payableService.js`, en `getSummary`, agregar `'CAPITAL_RETURN'` a las DOS listas `type: { in: [...] }` de payables (el `aggregate` de "por pagar" y el `count` de vencidos):

```js
      type: { in: ['PAYABLE', 'COMMISSION', 'PROFIT_SHARE', 'PARTNER_SHARE', 'CAPITAL_RETURN'] },
```

(aplícalo en ambas apariciones dentro de `getSummary`).

- [ ] **Step 10: Correr la suite backend (sin regresión)**

Run: `cd backend && node --test`
Expected: PASS (toda la suite verde, incluidos los nuevos casos).

- [ ] **Step 11: Commit**

```bash
git add backend/src/services/payableService.js backend/src/services/__tests__/payableService.socioPending.test.js backend/src/services/__tests__/payableService.addPayment.socio.test.js
git commit -m "feat: payableService — categoría CAPITAL_RETURN, bucket capital y conteo en getSummary"
```

---

### Task 4: Frontend — sección "Capital por devolver" + ocultar SOCIO del cobro

**Files:**
- Modify: `frontend/src/components/treasury/SocioPendingWidget.jsx`
- Modify: `frontend/src/components/treasury/SalePaymentModal.jsx`

**Interfaces:**
- Consumes: `getSocioPending()` ahora devuelve `{ capital, profit, commission }` (Task 3).
- Produces: el widget muestra 3 secciones; el cobro de venta excluye cuentas SOCIO.

- [ ] **Step 1: Widget — leer y renderizar el bucket `capital`**

En `frontend/src/components/treasury/SocioPendingWidget.jsx`:

- Cambiar el destructuring y el guard de auto-ocultar para incluir `capital`:

```jsx
  if (!data) return null;
  const { capital, profit, commission } = data;
  if (capital.count === 0 && profit.count === 0 && commission.count === 0) return null;
```

- Agregar la sección "Capital por devolver" **antes** de la sección de ganancia (dentro del `return`, justo antes del bloque `{profit.count > 0 && (...)}`):

```jsx
      {capital.count > 0 && (
        <Section
          title="Capital por devolver"
          icon={<ArrowUpRight className="w-4 h-4 text-red-400" />}
          bucket={capital}
          accent="red"
          onRow={(item) => setSelected({ item, kind: 'capital' })}
        />
      )}
```

- En el bloque de ganancia y comisión, envolver con separación superior cuando haya sección previa. Para mantenerlo simple: dejar el de ganancia con `className={capital.count > 0 ? 'mt-5' : ''}` alrededor, análogo a como comisión ya usa `profit.count > 0 ? 'mt-5' : ''`. Reemplazar el bloque de ganancia por:

```jsx
      {profit.count > 0 && (
        <div className={capital.count > 0 ? 'mt-5' : ''}>
          <Section
            title="Ganancia por pagar"
            icon={<ArrowUpRight className="w-4 h-4 text-red-400" />}
            bucket={profit}
            accent="red"
            onRow={(item) => setSelected({ item, kind: 'profit' })}
          />
        </div>
      )}
```

Y el de comisión, ajustar su margen superior para considerar también `capital`:

```jsx
      {commission.count > 0 && (
        <div className={(capital.count > 0 || profit.count > 0) ? 'mt-5' : ''}>
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

- El modal: `capital` es un egreso al socio (como la ganancia). Ajustar `isExpense` y los textos para cubrir `kind === 'capital'`. Reemplazar la línea de `isExpense` y el `title`/`defaultDescription` del `PaymentModal`:

```jsx
  const isExpense = selected?.kind === 'profit' || selected?.kind === 'capital';
```

Y en el `PaymentModal`:

```jsx
          title={
            selected.kind === 'capital'
              ? 'Devolver capital al socio'
              : isExpense ? 'Pagar ganancia socio' : 'Cobrar comisión socio'
          }
          type={isExpense ? 'expense' : 'income'}
          totalAmount={selected.item.totalAmount}
          paidAmount={selected.item.paidAmount}
          defaultDescription={
            selected.kind === 'capital'
              ? `Devolución de capital ${selected.item.vehicle?.plate || ''}`.trim()
              : isExpense
                ? `Ganancia socio ${selected.item.vehicle?.plate || ''}`.trim()
                : `Comisión socio ${selected.item.vehicle?.plate || ''}`.trim()
          }
          thirdPartyId={isExpense ? selected.item.thirdParty?.id : null}
          loading={processing}
```

(La sección "capital" usa el mismo enrutamiento FASE B que "profit": al ser egreso a un socio con cuenta, entra a su cuenta.)

- [ ] **Step 2: `SalePaymentModal` — ocultar cuentas SOCIO del cobro**

En `frontend/src/components/treasury/SalePaymentModal.jsx`, el selector simple de "Cuenta *" (CASH/TRANSFER) mapea `accounts.map(...)`. Cambiarlo para excluir cuentas SOCIO. Reemplazar:

```jsx
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
```

por:

```jsx
                    {accounts.filter((a) => a.type !== 'SOCIO').map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
```

(El modo mixto ya usa `cashAccounts`/`bankAccounts` = CASH/BANK, que no incluyen SOCIO; no requiere cambio.)

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: build OK, sin errores.

- [ ] **Step 4: Verificación manual (con backend+frontend levantados por el usuario)**

- Widget "Socios: pendientes" muestra 3 secciones cuando hay pendientes: "Capital por devolver", "Ganancia por pagar", "Comisión por cobrar". Tocar una fila de capital abre "Devolver capital al socio" y, al pagar, el dinero entra a la cuenta del socio.
- Al registrar/cobrar una venta, el selector de cuenta NO lista cuentas tipo Socio.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/treasury/SocioPendingWidget.jsx frontend/src/components/treasury/SalePaymentModal.jsx
git commit -m "feat: widget socios con sección Capital por devolver; cobro de venta oculta cuentas SOCIO"
```

---

### Task 5: E2E — round-trip completo del inversionista 100%

**Files:**
- Modify: `tests/helpers/api.ts` (campo `capital` en el tipo de `apiGetSocioPending`)
- Modify: `tests/e2e/treasury/socio.spec.ts` (test de round-trip)

**Interfaces:**
- Consumes: `GET /api/payables/socio-pending` (ahora con `capital`), helpers existentes y `TEST_SEED_IDS`.

- [ ] **Step 1: Extender el tipo del helper**

En `tests/helpers/api.ts`, en el tipo de retorno de `apiGetSocioPending`, agregar el bucket `capital`:

```ts
export async function apiGetSocioPending(
  token: string,
): Promise<{ capital: SocioPendingBucket; profit: SocioPendingBucket; commission: SocioPendingBucket }> {
  return getJson('/payables/socio-pending', token);
}
```

- [ ] **Step 2: Escribir el test de round-trip**

En `tests/e2e/treasury/socio.spec.ts`, agregar (reutiliza `buyVehicleWithSocio`/`sellSocioVehicleCash` y `apiGetSocioPending`, `apiGetAccount`, `apiRequestRaw`, `apiListPayables`, ya importados o a importar):

```ts
  test('Modelo B: round-trip inversionista 100% — capital vuelve a la cuenta del socio', async () => {
    const token = await apiPinLogin();
    // Inversionista 100% (participation 0 → socioShare 1). buyVehicleWithSocio compra 20M;
    // sellSocioVehicleCash vende 30M. partnerContribution = 20M (aporte del socio).
    const v = await buyVehicleWithSocio(token, plate('MB'), { partnerId: 'owner-self', participation: 0 });
    await sellSocioVehicleCash(token, v.id);

    const pend = await apiGetSocioPending(token);
    const cap = pend.capital.items.find((it) => it.vehicleId === v.id);
    const prof = pend.profit.items.find((it) => it.vehicleId === v.id);
    expect(cap).toBeTruthy();
    expect(prof).toBeTruthy();
    expect(cap!.pending).toBe(20_000_000); // capital = aporte

    // Pagar la devolución de capital desde una cuenta de empresa → entra a la cuenta socio.
    const socioBefore = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
    const payCap = await apiRequestRaw('POST', `/payables/${cap!.id}/payments`, token, {
      accountId: TEST_SEED_IDS.accountCash, amount: cap!.pending, description: 'Devolución capital (round-trip)',
    });
    expect(payCap.status).toBe(201);
    expect(payCap.body?.transaction?.category).toBe('CAPITAL_RETURN');
    expect(payCap.body?.transaction?.type).toBe('EXPENSE');

    const socioAfter = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
    expect(Number(socioAfter.currentBalance)).toBe(Number(socioBefore.currentBalance) + 20_000_000);

    // Ya no aparece en el bucket capital.
    const pend2 = await apiGetSocioPending(token);
    expect(pend2.capital.items.some((it) => it.vehicleId === v.id)).toBe(false);
  });
```

(Nota para el implementador: `buyVehicleWithSocio` con `owner-self` requiere que `owner-self` esté en `investor_team`; el spec `socio.spec.ts` ya usa `owner-self` como inversionista 100% en otro test, así que el seed lo soporta. Si `TEST_SEED_IDS.partnerAccount` corresponde a `test-tp-partner` y no a `owner-self`, usar el `partnerId` que tenga cuenta SOCIO sembrada — ajustar al helper/seed real; el objetivo es un inversionista 100% con cuenta SOCIO. Verificar contra `tests/global-setup.ts`.)

- [ ] **Step 3: Correr el test targeted**

Run (desde la raíz): `npm run test:e2e -- tests/e2e/treasury/socio.spec.ts -g "Modelo B"`
Expected: PASS.

- [ ] **Step 4: Correr el spec completo (regresión)**

Run: `npm run test:e2e -- tests/e2e/treasury/socio.spec.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/api.ts tests/e2e/treasury/socio.spec.ts
git commit -m "test(e2e): round-trip inversionista 100% — devolución de capital vuelve a la cuenta socio"
```

---

## Self-Review

**1. Spec coverage:**
- §3/§4.1-2 CxP CAPITAL_RETURN al vender + guard cancelSale → Task 2.
- §4.1 enum → Task 1.
- §4.3 categoría en addPayment → Task 3 (Steps 5-8).
- §4.4 bucket capital en getSocioPending → Task 3 (Steps 1-4).
- §4.5 getSummary cuenta CAPITAL_RETURN → Task 3 (Step 9).
- §5.1 tercera sección del widget → Task 4 (Step 1).
- §5.2 ocultar SOCIO del cobro → Task 4 (Step 2).
- §6 tests unit + E2E round-trip → Tasks 2,3 (unit) + Task 5 (E2E).
- §8 reverso no se amplía; trade-in solo si partnerContribution>0 (guard uniforme en Task 2). ✔

**2. Placeholder scan:** sin TBD/TODO. Las notas condicionales (ajustar al patrón del archivo de tests, verificar `TEST_SEED_IDS` contra el seed) son instrucciones legítimas de reconciliación con código no mostrado, no placeholders de lógica.

**3. Type/consistency:** el contrato de `getSocioPending` pasa de `{ profit, commission }` a `{ capital, profit, commission }` de forma consistente entre Task 3 (service), Task 4 (widget lee `capital`) y Task 5 (tipo del helper). `CAPITAL_RETURN` se usa idéntico en enum (Task 1), creación (Task 2), categoría/bucket/summary (Task 3) y aserciones E2E (Task 5). El `kind: 'capital'` del widget enruta como egreso (isExpense) igual que `'profit'`.
