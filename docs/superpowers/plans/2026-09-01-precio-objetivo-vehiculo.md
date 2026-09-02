# Precio objetivo de venta por vehículo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir un precio objetivo de venta por vehículo (`target = costo vivo × (1 + margen)`) con semáforo de cumplimiento y un agregado del inventario activo.

**Architecture:** El target se calcula (no se persiste) dentro de `calculateVehicleMetrics` en `backend/src/utils/financial.js`, reusando `realCostWithFixed`. El margen sale de un default global en la tabla `Setting` (`targetMarginDefault`), sobreescribible por un campo nuevo `Vehicle.targetMargin`. El agregado vive en `dashboardService.getPipelineTarget()`. El frontend consume los campos nuevos de `metrics` sin recalcular.

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (backend, CommonJS) · React 18 + Vite + Tailwind (frontend, ES Modules) · `node:test` + `node:assert/strict` (tests backend — **no hay Jest en el repo**) · Joi (validación).

**Spec:** `docs/superpowers/specs/2026-09-01-precio-objetivo-vehiculo-design.md`

## Global Constraints

- Backend en CommonJS (`require`), no ES Modules. Frontend en ES Modules (`import`).
- Moneda COP sin decimales: redondear todo valor monetario con `Math.round`.
- Idioma UI: Español (Colombia). Idioma del código: Inglés.
- Margen almacenado como **fracción decimal** en `[0, 1]` (ej. `0.15`), consistente con `participation`. La UI muestra porcentaje (×100) y convierte al guardar (÷100).
- Validación con Joi en endpoints. Patrón Controller → Service → Prisma; sin lógica de negocio en controllers.
- `DEFAULT_TARGET_MARGIN = 0.15` como fallback de código cuando no existe el `Setting`.
- Tests backend con `node:test` + `node:assert/strict` (runner: `node --test src/`). NO usar Jest — no está instalado. Mockear Prisma inyectando en `require.cache`, como en `src/services/__tests__/payableService.getSummary.test.js`.
- Stages de inventario **activo** para el agregado: `COMPRADO`, `ALISTAMIENTO`, `PUBLICADO`, `DISPONIBLE` (excluye `NEGOCIANDO` y `VENDIDO`).

---

## File Structure

- `backend/prisma/schema.prisma` — nuevo campo `targetMargin` en `model Vehicle`.
- `backend/src/utils/financial.js` — constante `DEFAULT_TARGET_MARGIN`; campos target en `calculateVehicleMetrics` y `projectProfit`.
- `backend/src/utils/__tests__/financial.test.js` — tests de la lógica de target.
- `backend/src/services/dashboardService.js` — método `getPipelineTarget()`; pasar `targetMarginDefault` a `calculateVehicleMetrics`.
- `backend/src/services/vehicleService.js` — pasar `targetMarginDefault` en cada llamada a `calculateVehicleMetrics`.
- `backend/src/services/__tests__/dashboardService.pipelineTarget.test.js` — tests del agregado.
- `backend/src/middleware/validation.js` — `targetMargin` en `vehicleUpdateSchema`.
- `backend/src/controllers/settingsController.js` — clamp/validación de `targetMarginDefault` en `update`.
- `backend/src/controllers/dashboardController.js` + `backend/src/routes/dashboard.js` — endpoint `GET /dashboard/pipeline-target`.
- `frontend/src/pages/SettingsPage.jsx` — campo "Margen objetivo (%)".
- `frontend/src/pages/VehicleDetailPage.jsx` — tarjeta "Precio objetivo" + input de override.
- `frontend/src/pages/VehiclesPage.jsx` — badge del semáforo target.

---

### Task 1: Migración Prisma — campo `targetMargin` en `Vehicle`

**Files:**
- Modify: `backend/prisma/schema.prisma` (dentro de `model Vehicle`, junto a `participation`)

**Interfaces:**
- Produces: columna `Vehicle.targetMargin Decimal? @db.Decimal(5,4)` (nullable, sin default).

Invocar la skill `database-migrations` antes de generar la migración.

- [ ] **Step 1: Añadir el campo al schema**

En `model Vehicle`, debajo de la línea `participation ... @db.Decimal(5, 4)`, añadir:

```prisma
  targetMargin           Decimal? @db.Decimal(5, 4)
```

- [ ] **Step 2: Generar la migración**

Run: `cd backend && npx prisma migrate dev --name add_vehicle_target_margin`
Expected: crea la migración y regenera el client sin errores. Campo nullable → sin backfill.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add targetMargin to Vehicle"
```

---

### Task 2: Lógica de target en `calculateVehicleMetrics`

**Files:**
- Modify: `backend/src/utils/financial.js:26` (firma y cuerpo de `calculateVehicleMetrics`; return object)
- Test: `backend/src/utils/__tests__/financial.test.js`

**Interfaces:**
- Consumes: `realCostWithFixed`, `referencePrice`, `salePrice`, `listedPrice`, `isSold` (ya calculados en la función).
- Produces: en el objeto retornado por `calculateVehicleMetrics`, nuevos campos:
  - `effectiveMargin: number`
  - `targetPrice: number` (COP redondeado)
  - `targetProfit: number` (COP redondeado)
  - `isCustomMargin: boolean`
  - `targetGap: number | null`
  - `targetStatus: 'MEETS' | 'PROFIT' | 'BELOW' | null`
  - Firma nueva: `calculateVehicleMetrics(vehicle, fixedMonthly = 800000, commissionPayables = [], targetMarginDefault = DEFAULT_TARGET_MARGIN)`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `backend/src/utils/__tests__/financial.test.js`:

```js
const { calculateVehicleMetrics } = require('../financial');

describe('calculateVehicleMetrics — precio objetivo', () => {
  // Base: compra 30M, sin gastos, sin fijos (sin purchaseDate → daysInInventory 0)
  const baseVehicle = {
    stage: 'PUBLICADO',
    purchasePrice: 30000000,
    listedPrice: 34500000,
    expenses: [],
  };

  test('usa el margen global cuando el vehículo no tiene override', () => {
    const m = calculateVehicleMetrics(baseVehicle, 0, [], 0.15);
    expect(m.effectiveMargin).toBe(0.15);
    expect(m.isCustomMargin).toBe(false);
    expect(m.targetPrice).toBe(34500000); // 30M × 1.15
    expect(m.targetProfit).toBe(4500000);
  });

  test('el override por vehículo tiene prioridad sobre el global', () => {
    const m = calculateVehicleMetrics({ ...baseVehicle, targetMargin: 0.2 }, 0, [], 0.15);
    expect(m.effectiveMargin).toBe(0.2);
    expect(m.isCustomMargin).toBe(true);
    expect(m.targetPrice).toBe(36000000); // 30M × 1.20
  });

  test('targetProfit == realCostWithFixed × effectiveMargin', () => {
    const m = calculateVehicleMetrics(baseVehicle, 0, [], 0.15);
    expect(m.targetProfit).toBe(Math.round(m.realCostWithFixed * m.effectiveMargin));
  });

  test("status MEETS cuando el publicado alcanza o supera el target", () => {
    const m = calculateVehicleMetrics({ ...baseVehicle, listedPrice: 35000000 }, 0, [], 0.15);
    expect(m.targetStatus).toBe('MEETS');
    expect(m.targetGap).toBe(500000); // 35M − 34.5M
  });

  test('status PROFIT cuando es rentable pero por debajo del target', () => {
    const m = calculateVehicleMetrics({ ...baseVehicle, listedPrice: 32000000 }, 0, [], 0.15);
    expect(m.targetStatus).toBe('PROFIT');
    expect(m.targetGap).toBe(-2500000);
  });

  test('status BELOW cuando el publicado no cubre el costo', () => {
    const m = calculateVehicleMetrics({ ...baseVehicle, listedPrice: 29000000 }, 0, [], 0.15);
    expect(m.targetStatus).toBe('BELOW');
  });

  test('sin listedPrice y no vendido → status y gap null', () => {
    const m = calculateVehicleMetrics({ ...baseVehicle, listedPrice: null }, 0, [], 0.15);
    expect(m.targetStatus).toBeNull();
    expect(m.targetGap).toBeNull();
  });

  test('vehículo vendido usa salePrice como referencia', () => {
    const sold = { stage: 'VENDIDO', purchasePrice: 30000000, listedPrice: 34500000, salePrice: 33000000, expenses: [], purchaseDate: '2026-01-01', saleDate: '2026-01-01' };
    const m = calculateVehicleMetrics(sold, 0, [], 0.15);
    expect(m.targetStatus).toBe('PROFIT'); // 33M ≥ costo 30M, < target 34.5M
    expect(m.targetGap).toBe(-1500000); // 33M − 34.5M
  });

  test('margen 0 → target == costo, profit 0', () => {
    const m = calculateVehicleMetrics(baseVehicle, 0, [], 0);
    expect(m.targetPrice).toBe(m.realCostWithFixed);
    expect(m.targetProfit).toBe(0);
  });

  test('sin costo (realCostWithFixed 0) → targetPrice 0 sin crash', () => {
    const m = calculateVehicleMetrics({ stage: 'NEGOCIANDO', purchasePrice: 0, listedPrice: null, expenses: [] }, 0, [], 0.15);
    expect(m.targetPrice).toBe(0);
    expect(m.targetStatus).toBeNull();
  });

  test('default de código 0.15 cuando no se pasa targetMarginDefault', () => {
    const m = calculateVehicleMetrics(baseVehicle, 0, []);
    expect(m.effectiveMargin).toBe(0.15);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: FAIL — los campos `targetPrice`, `targetStatus`, etc. son `undefined`.

- [ ] **Step 3: Implementar**

En `backend/src/utils/financial.js`, al inicio del archivo (después del comentario de cabecera) añadir la constante:

```js
const DEFAULT_TARGET_MARGIN = 0.15; // fallback si no hay Setting targetMarginDefault
```

Cambiar la firma de la función (línea 26):

```js
function calculateVehicleMetrics(vehicle, fixedMonthly = 800000, commissionPayables = [], targetMarginDefault = DEFAULT_TARGET_MARGIN) {
```

Dentro de la función, después de que `realCostWithFixed`, `referencePrice` e `isSold` ya están calculados (justo antes del `return`), añadir:

```js
  // ── Precio objetivo (target) ──────────────────────────────────
  const isCustomMargin = vehicle.targetMargin != null;
  const effectiveMargin = isCustomMargin ? Number(vehicle.targetMargin) : targetMarginDefault;
  const targetPrice = Math.round(realCostWithFixed * (1 + effectiveMargin));
  const targetProfit = Math.round(realCostWithFixed * effectiveMargin);
  const targetGap = referencePrice > 0 ? Math.round(referencePrice - targetPrice) : null;

  let targetStatus = null;
  if (referencePrice > 0) {
    if (referencePrice >= targetPrice) targetStatus = 'MEETS';
    else if (referencePrice >= realCostWithFixed) targetStatus = 'PROFIT';
    else targetStatus = 'BELOW';
  }
```

Añadir estos campos al objeto que retorna la función:

```js
    effectiveMargin,
    isCustomMargin,
    targetPrice,
    targetProfit,
    targetGap,
    targetStatus,
```

Exportar la constante si el módulo usa exports nombrados (añadir `DEFAULT_TARGET_MARGIN` al `module.exports`).

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: PASS (incluidos los tests preexistentes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/financial.js backend/src/utils/__tests__/financial.test.js
git commit -m "feat(financial): precio objetivo y semáforo en calculateVehicleMetrics"
```

---

### Task 2b: Target en `projectProfit` (simulador)

**Files:**
- Modify: `backend/src/utils/financial.js:140` (`projectProfit`)
- Test: `backend/src/utils/__tests__/financial.test.js`

**Interfaces:**
- Consumes: `DEFAULT_TARGET_MARGIN` (Task 2).
- Produces: `projectProfit` acepta `targetMargin` en params (con default `DEFAULT_TARGET_MARGIN`) y retorna `targetPrice`, `targetProfit` calculados sobre `totalCost`.

- [ ] **Step 1: Escribir el test que falla**

```js
const { projectProfit } = require('../financial');

describe('projectProfit — target', () => {
  test('calcula targetPrice sobre el totalCost con el margen dado', () => {
    const r = projectProfit({ purchasePrice: 20000000, estimatedExpenses: 0, salePrice: 25000000, estimatedDays: 0, targetMargin: 0.15 });
    expect(r.targetPrice).toBe(23000000); // 20M × 1.15
    expect(r.targetProfit).toBe(3000000);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: FAIL — `targetPrice` undefined.

- [ ] **Step 3: Implementar**

En `projectProfit`, añadir `targetMargin = DEFAULT_TARGET_MARGIN` a los params desestructurados y, antes del `return`:

```js
  const targetPrice = Math.round(totalCost * (1 + targetMargin));
  const targetProfit = Math.round(totalCost * targetMargin);
```

Añadir `targetPrice` y `targetProfit` al objeto retornado.

- [ ] **Step 4: Verificar que pasa**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/financial.js backend/src/utils/__tests__/financial.test.js
git commit -m "feat(financial): target price en projectProfit"
```

---

### Task 3: Propagar `targetMarginDefault` a los callers de `calculateVehicleMetrics`

**Files:**
- Modify: `backend/src/services/vehicleService.js` (cada llamada a `calculateVehicleMetrics`)
- Modify: `backend/src/services/dashboardService.js` (llamadas en `getOverview` y otras)

**Interfaces:**
- Consumes: firma nueva de `calculateVehicleMetrics` (Task 2).
- Produces: todas las rutas que devuelven `metrics` honran el `Setting targetMarginDefault`.

Sin este task, los callers usan el default de código (0.15) e ignoran el margen global configurado. El patrón de lectura ya existe para `fixedMonthly`.

- [ ] **Step 1: Localizar los call sites**

Run: `cd backend && grep -rn "calculateVehicleMetrics(" src/services`
Anotar cada bloque; todos ya leen `fixedSetting` cerca.

- [ ] **Step 2: En cada bloque, leer también el margen y pasarlo**

Junto a cada `const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });`, añadir:

```js
    const marginSetting = await prisma.setting.findUnique({ where: { key: 'targetMarginDefault' } });
    const targetMarginDefault = marginSetting ? parseFloat(marginSetting.value) : 0.15;
```

Y actualizar la llamada correspondiente para pasar el 4º argumento. Ejemplos según los call sites actuales:

- Con comisiones (vehicleService `getById`):
  ```js
  metrics: calculateVehicleMetrics(vehicle, fixedMonthly, commissionPayables, targetMarginDefault)
  ```
- Sin comisiones:
  ```js
  metrics: calculateVehicleMetrics(v, fixedMonthly, [], targetMarginDefault)
  ```

Aplicar a todos los call sites hallados en el Step 1 (vehicleService y dashboardService `getOverview`).

- [ ] **Step 3: Verificar que la suite sigue verde**

Run: `cd backend && node --test src/`
Expected: PASS (ningún test roto; los metrics ahora incluyen campos target).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/vehicleService.js backend/src/services/dashboardService.js
git commit -m "feat(services): honrar targetMarginDefault en métricas de vehículo"
```

---

### Task 4: Agregado del inventario — `dashboardService.getPipelineTarget()`

**Files:**
- Modify: `backend/src/services/dashboardService.js`
- Test: `backend/src/services/__tests__/dashboardService.pipelineTarget.test.js` (Create)

**Interfaces:**
- Consumes: `calculateVehicleMetrics` (Task 2), `Setting` keys `fixedMonthly` y `targetMarginDefault`.
- Produces: `getPipelineTarget(userId)` → `{ vehicleCount, sumTargetPrice, sumTargetProfit, sumRealCost, sumListed, pipelineGap, statusCounts: { MEETS, PROFIT, BELOW, unknown } }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/services/__tests__/dashboardService.pipelineTarget.test.js`:

Usa el patrón de mocking del repo (inyección en el require cache), idéntico al de
`src/services/__tests__/payableService.getSummary.test.js`. **No hay Jest en este
proyecto**: el runner es `node:test` con `node:assert/strict`.

```js
'use strict';
// getPipelineTarget — agregado de la meta del pipeline sobre el inventario activo.
// Se reemplaza `../config/database` en el require cache por un prisma falso.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let vehiclesFixture = [];
let lastFindManyArgs = null;

const fakePrisma = {
  setting: {
    findUnique: async ({ where }) => (
      where.key === 'targetMarginDefault' ? { value: '0.15' } : { value: '0' }
    ),
  },
  vehicle: {
    findMany: async (args) => {
      lastFindManyArgs = args;
      return vehiclesFixture;
    },
  },
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const dashboardService = require('../dashboardService');

test('getPipelineTarget: suma solo stages activos y calcula la brecha', async () => {
  vehiclesFixture = [
    { stage: 'PUBLICADO', purchasePrice: 30_000_000, listedPrice: 35_000_000, expenses: [] }, // target 34.5M, MEETS
    { stage: 'DISPONIBLE', purchasePrice: 20_000_000, listedPrice: 21_000_000, expenses: [] }, // target 23M, PROFIT
  ];

  const r = await dashboardService.getPipelineTarget('user1');

  assert.equal(lastFindManyArgs.where.userId, 'user1');
  assert.deepEqual(lastFindManyArgs.where.stage, {
    in: ['COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE'],
  });
  assert.equal(r.vehicleCount, 2);
  assert.equal(r.sumTargetPrice, 57_500_000); // 34.5M + 23M
  assert.equal(r.sumListed, 56_000_000); // 35M + 21M
  assert.equal(r.pipelineGap, -1_500_000); // 56M − 57.5M
  assert.equal(r.statusCounts.MEETS, 1);
  assert.equal(r.statusCounts.PROFIT, 1);
});

test('getPipelineTarget: inventario vacío → ceros sin crash', async () => {
  vehiclesFixture = [];

  const r = await dashboardService.getPipelineTarget('user1');

  assert.equal(r.vehicleCount, 0);
  assert.equal(r.sumTargetPrice, 0);
  assert.equal(r.pipelineGap, 0);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `cd backend && node --test src/services/__tests__/dashboardService.pipelineTarget.test.js`
Expected: FAIL — `getPipelineTarget is not a function`.

- [ ] **Step 3: Implementar**

En `backend/src/services/dashboardService.js`, dentro de `class DashboardService`, añadir:

```js
  async getPipelineTarget(userId) {
    const ACTIVE_STAGES = ['COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE'];
    const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });
    const marginSetting = await prisma.setting.findUnique({ where: { key: 'targetMarginDefault' } });
    const fixedMonthly = fixedSetting ? parseFloat(fixedSetting.value) : 800000;
    const targetMarginDefault = marginSetting ? parseFloat(marginSetting.value) : 0.15;

    const vehicles = await prisma.vehicle.findMany({
      where: { userId, stage: { in: ACTIVE_STAGES } },
      include: { expenses: true },
    });

    const acc = {
      vehicleCount: vehicles.length,
      sumTargetPrice: 0,
      sumTargetProfit: 0,
      sumRealCost: 0,
      sumListed: 0,
      statusCounts: { MEETS: 0, PROFIT: 0, BELOW: 0, unknown: 0 },
    };

    for (const v of vehicles) {
      const m = calculateVehicleMetrics(v, fixedMonthly, [], targetMarginDefault);
      acc.sumTargetPrice += m.targetPrice;
      acc.sumTargetProfit += m.targetProfit;
      acc.sumRealCost += m.realCostWithFixed;
      acc.sumListed += Number(v.listedPrice || 0);
      const key = m.targetStatus || 'unknown';
      acc.statusCounts[key] += 1;
    }

    acc.pipelineGap = acc.sumListed - acc.sumTargetPrice;
    return acc;
  }
```

- [ ] **Step 4: Verificar que pasa**

Run: `cd backend && node --test src/services/__tests__/dashboardService.pipelineTarget.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dashboardService.js backend/src/services/__tests__/dashboardService.pipelineTarget.test.js
git commit -m "feat(dashboard): agregado de meta del pipeline (getPipelineTarget)"
```

---

### Task 5: Endpoint `GET /dashboard/pipeline-target`

**Files:**
- Modify: `backend/src/controllers/dashboardController.js`
- Modify: `backend/src/routes/dashboard.js`

**Interfaces:**
- Consumes: `dashboardService.getPipelineTarget(userId)` (Task 4).
- Produces: ruta `GET /dashboard/pipeline-target` → JSON del agregado.

Invocar la skill `api-design` para confirmar status codes y forma del envelope antes de escribir el controller.

- [ ] **Step 1: Añadir el handler**

En `backend/src/controllers/dashboardController.js`, junto a `getOverview`:

```js
const getPipelineTarget = async (req, res, next) => {
  try {
    const data = await dashboardService.getPipelineTarget(req.user.id);
    res.json(data);
  } catch (err) { next(err); }
};
```

Añadir `getPipelineTarget` al `module.exports`.

- [ ] **Step 2: Registrar la ruta**

En `backend/src/routes/dashboard.js`, junto a `router.get('/overview', ctrl.getOverview);`:

```js
router.get('/pipeline-target', ctrl.getPipelineTarget);
```

- [ ] **Step 3: Verificar manualmente**

Run: `cd backend && npm run dev` y en otra terminal autenticado: `curl -s localhost:PUERTO/api/dashboard/pipeline-target -H "Authorization: Bearer <token>"`
Expected: 200 con el objeto `{ vehicleCount, sumTargetPrice, ... }`. (O confiar en el test de servicio de Task 4 + smoke posterior.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/dashboardController.js backend/src/routes/dashboard.js
git commit -m "feat(api): endpoint GET /dashboard/pipeline-target"
```

---

### Task 6: Validación — `targetMargin` por vehículo y `targetMarginDefault` global

**Files:**
- Modify: `backend/src/middleware/validation.js:81` (`vehicleUpdateSchema`)
- Modify: `backend/src/controllers/settingsController.js` (`update`)

**Interfaces:**
- Produces: `PATCH /vehicles/:id` acepta `targetMargin` (0–1, nullable); `PUT /settings` rechaza `targetMarginDefault` fuera de `[0,1]`.

- [ ] **Step 1: Añadir `targetMargin` al schema de update de vehículo**

En `vehicleUpdateSchema` (línea ~81), junto a `participation: Joi.number().min(0).max(1),`, añadir:

```js
  targetMargin: Joi.number().min(0).max(1).allow(null),
```

- [ ] **Step 2: Validar `targetMarginDefault` en el update de settings**

En `settingsController.js`, dentro de `update`, antes del loop de upsert:

```js
    if (req.body.targetMarginDefault !== undefined) {
      const margin = parseFloat(req.body.targetMarginDefault);
      if (Number.isNaN(margin) || margin < 0 || margin > 1) {
        return res.status(400).json({ error: 'targetMarginDefault debe estar entre 0 y 1' });
      }
    }
```

- [ ] **Step 3: Verificar la suite**

Run: `cd backend && node --test src/`
Expected: PASS (incluye `settingsController.test.js` existente).

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/validation.js backend/src/controllers/settingsController.js
git commit -m "feat(validation): targetMargin por vehículo y targetMarginDefault global"
```

---

### Task 7: Frontend — campo "Margen objetivo (%)" en Configuración

**Files:**
- Modify: `frontend/src/pages/SettingsPage.jsx`

**Interfaces:**
- Consumes: `GET /settings` (devuelve `targetMarginDefault` como fracción string) y `PUT /settings`, vía `fetchSettings`/`updateSettings` de `useApp()` (`@/contexts/AppContext`) que la página YA usa.
- Produces: la UI persiste `targetMarginDefault` como fracción decimal.

- [ ] **Step 1: Cargar el valor (fracción → porcentaje)**

En el `useState` inicial (línea 12) añadir la clave y en el `fetchSettings().then(...)` (línea 22) hidratarla convirtiendo a %:

```js
  const [settings, setSettings] = useState({ fixedMonthly: '800000', alertDays: '15', targetMarginPct: '15' });
```
```js
    fetchSettings().then(s => { if (s) setSettings({
      fixedMonthly: s.fixedMonthly || '800000',
      alertDays: s.alertDays || '15',
      targetMarginPct: s.targetMarginDefault != null ? String(Math.round(parseFloat(s.targetMarginDefault) * 100)) : '15',
    }); });
```

- [ ] **Step 2: Guardar (porcentaje → fracción)**

Reemplazar `handleSaveSettings` (línea 47):

```js
  const handleSaveSettings = () => {
    const { targetMarginPct, ...rest } = settings;
    updateSettings({ ...rest, targetMarginDefault: (parseFloat(targetMarginPct) || 0) / 100 });
  };
```

- [ ] **Step 3: Añadir el input**

Junto al input de "Gasto Fijo Mensual" (línea ~118):

```jsx
            <Input label="Margen Objetivo (%)" type="number" value={settings.targetMarginPct} onChange={e => setSettings(p => ({ ...p, targetMarginPct: e.target.value }))} help="Ganancia objetivo sobre el costo. Fija el precio objetivo de venta de cada carro." />
```

- [ ] **Step 4: Verificar en el navegador**

Run: `cd frontend && npm run dev` → Configuración → Negocio: el campo muestra 15, guarda y recarga manteniendo el valor.
Expected: persiste como `0.15` en el backend.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SettingsPage.jsx
git commit -m "feat(settings-ui): campo de margen objetivo global"
```

---

### Task 8: Frontend — tarjeta "Precio objetivo" en el detalle del vehículo

**Files:**
- Modify: `frontend/src/pages/VehicleDetailPage.jsx`

**Interfaces:**
- Consumes: `vehicle.metrics.{targetPrice, targetProfit, effectiveMargin, isCustomMargin, targetGap, targetStatus}` (Task 2) y `PATCH /vehicles/:id` con `targetMargin`.
- Produces: tarjeta visual con semáforo + input de override.

- [ ] **Step 1: Helper de color/label del semáforo**

En `VehicleDetailPage.jsx`, cerca de los otros helpers, añadir:

```jsx
const TARGET_STATUS = {
  MEETS:  { label: 'Cumple meta', color: '#3FB950' },
  PROFIT: { label: 'Rentable, bajo meta', color: '#D29922' },
  BELOW:  { label: 'No cubre meta', color: '#F85149' },
};
```

- [ ] **Step 2: Renderizar la tarjeta**

En la sección financiera (donde se usan los `FinCard`, cerca de la línea 745 tras "COSTO REAL TOTAL"), añadir un bloque que use `m.targetStatus`:

```jsx
      {m.targetPrice > 0 && (
        <div className="p-4 rounded-xl border border-accent/20 bg-accent/5">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-[#8B949E]">
              Precio Objetivo
              <span className="ml-1 text-accent">{m.isCustomMargin ? '(personalizado)' : '(global)'} · {formatPercent(m.effectiveMargin)}</span>
            </div>
            {m.targetStatus && (
              <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: TARGET_STATUS[m.targetStatus].color + '18', color: TARGET_STATUS[m.targetStatus].color }}>
                {TARGET_STATUS[m.targetStatus].label}
              </span>
            )}
          </div>
          <div className="text-xl font-bold text-accent mt-1">{formatCurrency(m.targetPrice)}</div>
          <div className="text-[11px] text-[#8B949E] mt-0.5">
            Ganancia objetivo: {formatCurrency(m.targetProfit)}
            {m.targetGap != null && <> · Brecha: {formatCurrency(m.targetGap)}</>}
          </div>
        </div>
      )}
```

- [ ] **Step 3: Input de override del margen**

Añadir (dentro de la misma tarjeta o cerca) un control que haga `PATCH /vehicles/:id` con `targetMargin` en fracción (o `null` para volver al global). Reusar el helper `api` y el refresh de vehículo que ya usa la página:

```jsx
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              placeholder="Margen % override"
              defaultValue={m.isCustomMargin ? Math.round(m.effectiveMargin * 100) : ''}
              className="w-32 bg-transparent border border-[#30363D] rounded px-2 py-1 text-sm"
              onBlur={async (e) => {
                const raw = e.target.value.trim();
                const targetMargin = raw === '' ? null : (parseFloat(raw) || 0) / 100;
                await api.patch(`/vehicles/${vehicle.id}`, { targetMargin });
                await loadVehicle();
              }}
            />
            <span className="text-[11px] text-[#8B949E]">vacío = margen global</span>
          </div>
```

La página ya define `loadVehicle()` (VehicleDetailPage.jsx:124) y ya importa `api` desde `@/lib/api`, `formatCurrency`/`formatPercent` desde `@/lib/constants`. Reusa esos — no crees helpers nuevos ni imports duplicados.

- [ ] **Step 4: Verificar en el navegador**

Run: frontend en dev → detalle de un carro PUBLICADO con `listedPrice`: la tarjeta muestra target, semáforo y brecha; cambiar el override recalcula tras guardar.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/VehicleDetailPage.jsx
git commit -m "feat(vehicle-ui): tarjeta de precio objetivo con semáforo y override"
```

---

### Task 9: Frontend — badge del semáforo en la lista de vehículos

**Files:**
- Modify: `frontend/src/pages/VehiclesPage.jsx`

**Interfaces:**
- Consumes: `v.metrics.targetStatus` (Task 2/3).
- Produces: badge de color junto al stage badge.

- [ ] **Step 1: Añadir el mapa de estados (si no está en un módulo compartido)**

```jsx
const TARGET_DOT = { MEETS: '#3FB950', PROFIT: '#D29922', BELOW: '#F85149' };
```

- [ ] **Step 2: Renderizar el badge**

Junto al `stage-badge` (línea ~52), usando `m` (ya declarado en línea 42):

```jsx
                  {m.targetStatus && (
                    <span className="stage-badge h-fit" title="Cumplimiento del precio objetivo"
                      style={{ background: TARGET_DOT[m.targetStatus] + '18', color: TARGET_DOT[m.targetStatus] }}>
                      Meta
                    </span>
                  )}
```

- [ ] **Step 3: Verificar en el navegador**

Run: frontend en dev → lista: los carros activos muestran el badge de meta con el color correcto.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/VehiclesPage.jsx
git commit -m "feat(vehicles-ui): badge de semáforo de meta en la lista"
```

---

### Task 10: Frontend — bloque "Meta del pipeline" en el dashboard

**Files:**
- Modify: `frontend/src/pages/DashboardPage.jsx`

**Interfaces:**
- Consumes: `GET /dashboard/pipeline-target` (Task 5).
- Produces: bloque con suma objetivo vs. publicado, brecha y conteo por estado.

⚠️ **Colisión de nombres — obligatorio respetar:** `DashboardPage.jsx:38` YA
desestructura una variable llamada `pipeline` (`const { kpis, pipeline, ... } = dashboard`),
que es la distribución de vehículos por stage y NO tiene relación con este agregado.
El estado nuevo se llama **`pipelineTarget`**. No reutilices ni sombrees `pipeline`.

La página ya importa `api` desde `@/lib/api` y `formatCurrency` desde `@/lib/constants`;
reusa esos imports.

- [ ] **Step 1: Fetch del agregado**

Junto a los otros `useState`/`useEffect` de la página (líneas ~14-27):

```jsx
  const [pipelineTarget, setPipelineTarget] = useState(null);

  useEffect(() => {
    api.get('/dashboard/pipeline-target')
      .then(r => setPipelineTarget(r.data))
      .catch(() => setPipelineTarget(null));
  }, []);
```

- [ ] **Step 2: Renderizar el bloque**

```jsx
      {pipelineTarget && pipelineTarget.vehicleCount > 0 && (
        <div className="p-4 rounded-xl border border-[#30363D]">
          <div className="text-sm font-semibold mb-2">Meta del pipeline</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[11px] text-[#8B949E]">Objetivo proyectado</div>
              {formatCurrency(pipelineTarget.sumTargetPrice)}
            </div>
            <div>
              <div className="text-[11px] text-[#8B949E]">Publicado hoy</div>
              {formatCurrency(pipelineTarget.sumListed)}
            </div>
            <div className="col-span-2">
              <div className="text-[11px] text-[#8B949E]">Brecha</div>
              <span style={{ color: pipelineTarget.pipelineGap >= 0 ? '#3FB950' : '#F85149' }}>
                {formatCurrency(pipelineTarget.pipelineGap)}
              </span>
            </div>
          </div>
          <div className="text-[11px] text-[#8B949E] mt-2">
            {pipelineTarget.statusCounts.MEETS} cumplen · {pipelineTarget.statusCounts.PROFIT} bajo meta · {pipelineTarget.statusCounts.BELOW} sin cubrir
          </div>
        </div>
      )}
```

- [ ] **Step 4: Verificar en el navegador**

Run: frontend en dev → dashboard: el bloque muestra sumas coherentes con el inventario activo.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.jsx
git commit -m "feat(dashboard-ui): bloque de meta del pipeline"
```

---

### Task 11: E2E + verificación final

**Files:**
- Create: `tests/e2e/vehicles/precio-objetivo.spec.ts`

**Convenciones reales del E2E de este repo (verificadas — no re-derivar):**
- Playwright vive en la **raíz del repo**, no en `frontend/`: `playwright.config.ts`,
  `@playwright/test ^1.47.0`, specs en `tests/e2e/<dominio>/*.spec.ts` (**TypeScript**).
- Comando: `npm run test:e2e` desde la raíz (`test:e2e:headed` / `test:e2e:ui` para depurar).
- Los specs importan el fixture propio del repo, no `@playwright/test` directo:
  `import { test, expect } from '../../fixtures/test';`
- Login por PIN: `const ADMIN_PIN = process.env.ADMIN_PIN || '1234';`
- Estilo de selectores: `getByRole`, `getByText`, esperas deterministas (`waitForURL`,
  `toBeVisible`), nunca `waitForTimeout`.
- No hay tests de componente en el frontend (existe vitest pero solo con un test de
  utilidad pura, y **no** hay `@testing-library`). No introduzcas testing de componentes.

Invocar la skill `e2e-testing` antes de escribir el spec.

- [ ] **Step 1: E2E de la tarjeta de target**

Crear `tests/e2e/vehicles/precio-objetivo.spec.ts` siguiendo el patrón de
`tests/e2e/auth/login.spec.ts`. Cubrir: el detalle de un vehículo con `listedPrice`
muestra la tarjeta "Precio Objetivo" con su semáforo.

- [ ] **Step 2: E2E del bloque de dashboard**

En el mismo spec: el bloque "Meta del pipeline" aparece en el dashboard y muestra los
conteos por estado.

- [ ] **Step 3: Verificación completa**

Invocar la skill `verification-loop`.

Run: `cd backend && node --test src/` → Expected: PASS (304+ tests)
Run: `cd frontend && npm run build` → Expected: build limpio
Run: `npm run test:e2e` desde la raíz → Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/e2e
git commit -m "test(target): e2e de precio objetivo y meta del pipeline"
```
