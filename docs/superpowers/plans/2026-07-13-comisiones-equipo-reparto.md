# Comisiones — Equipo de reparto dinámico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repartir el bolsillo de comisión de cada venta entre hasta 5 personas (la parte del dueño es el resto, automática), con equipo default en Settings, editor por venta, métricas por persona y card en el Dashboard.

**Architecture:** El equipo default vive como Setting JSON (`commission_default_team`) — sin migración. `resolveParticipants` (commissionService) implementa el contrato "suma ≤ 100 + resto al dueño" con fallback legacy intacto. Un endpoint de agregados (`GET /commissions/summary`) alimenta el Dashboard y la sección "Por persona". Un componente `CommissionSplitEditor` se comparte entre Settings y el modal de venta.

**Tech Stack:** Node/Express/Prisma (CommonJS), node:test, React 18 + Vite (ESM), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-13-comisiones-equipo-reparto-design.md`

## Global Constraints

- Backend CommonJS; frontend ESM; UI español (Colombia); COP via `formatCurrency`.
- Matemática financiera solo en backend (`financial.js`/`commissionService`); el front solo pinta.
- **Contrato de reparto**: máx 5 personas (constante `MAX_PARTICIPANTS = 5`), suma sharePct ≤ 100 (tolerancia 0.001), sin `thirdPartyId` duplicados, cada `sharePct > 0`, `owner-self` prohibido en las filas (400); el resto (100 − suma) genera fila del dueño (`owner-self`, rol `OTHER`) solo si > 0.
- **Fallback legacy intacto**: sin equipo configurado y sin `participants` → comportamiento actual (owner captador/cerrador con `default_captador_pct`/`default_cerrador_pct`). Ventas históricas no cambian.
- Copys exactos: Settings "Equipo de reparto", línea viva `Tu parte: X%`; modal de venta "Comisión — Reparto (default: tu equipo)"; página "Por persona"; Dashboard card "Comisiones" con `Pendientes` y `Pagado este mes`.
- `saleService` NO se modifica (resolveParticipants ya le devuelve la lista final con la fila del dueño incluida).
- Antes del merge: suite backend completa + build frontend + e2e nuevos + treasury sin regresiones.

---

### Task 1: Backend — contrato de reparto en `resolveParticipants` (TDD)

**Files:**
- Modify: `backend/src/services/commissionService.js` (reescribir `resolveParticipants`, extender `loadCommissionConfig`, exportar `MAX_PARTICIPANTS`)
- Test: `backend/src/services/__tests__/commissionService.test.js` (agregar bloque al final)

**Interfaces:**
- Consumes: nada nuevo (usa `AppError` y `prismaOrTx.thirdParty.findMany` ya presentes en el archivo).
- Produces:
  - `loadCommissionConfig(prismaOrTx)` devuelve además `defaultTeam: Array<{thirdPartyId, role, sharePct}>|null` (parse defensivo del Setting `commission_default_team`; JSON corrupto → `null` + `console.warn`). La key nueva NO es requerida (DBs desplegadas no la tienen).
  - `resolveParticipants(prismaOrTx, saleParticipants, cfg)` → lista final `[{thirdPartyId, role, sharePct}]` que SIEMPRE suma 100 (incluye la fila `owner-self` por el resto cuando aplica). `MAX_PARTICIPANTS = 5` exportado. Tasks 3/6 dependen de estos nombres.

- [ ] **Step 1: Tests del contrato (RED)**

Agregar al final de `backend/src/services/__tests__/commissionService.test.js`:

```js
// ── resolveParticipants (equipo de reparto + resto al dueño) ─────
const { resolveParticipants, MAX_PARTICIPANTS } = require('../commissionService');
const { AppError } = require('../../middleware/errorHandler');

// Stub de prisma: los terceros consultados existen salvo los marcados.
const mkTx = (missingIds = []) => ({
  thirdParty: {
    findMany: async ({ where }) =>
      where.id.in.filter((id) => !missingIds.includes(id)).map((id) => ({ id })),
    findUnique: async ({ where }) =>
      missingIds.includes(where.id) ? null : { id: where.id },
  },
});

const CFG_LEGACY = { defaultCaptadorPct: 30, defaultCerradorPct: 70, defaultTeam: null };

test('reparto: participants explícitos suman <100 → fila owner por el resto', async () => {
  const out = await resolveParticipants(mkTx(), [
    { thirdPartyId: 'tp-vendedor', role: 'CAPTADOR', sharePct: 30 },
    { thirdPartyId: 'tp-papa', role: 'OTHER', sharePct: 15 },
    { thirdPartyId: 'tp-mama', role: 'OTHER', sharePct: 15 },
  ], CFG_LEGACY);
  assert.equal(out.length, 4);
  const owner = out.find((p) => p.thirdPartyId === 'owner-self');
  assert.equal(owner.sharePct, 40);
  assert.equal(owner.role, 'OTHER');
  assert.equal(out.reduce((s, p) => s + p.sharePct, 0), 100);
});

test('reparto: suma exactamente 100 → SIN fila owner', async () => {
  const out = await resolveParticipants(mkTx(), [
    { thirdPartyId: 'a', role: 'CAPTADOR', sharePct: 60 },
    { thirdPartyId: 'b', role: 'CERRADOR', sharePct: 40 },
  ], CFG_LEGACY);
  assert.equal(out.length, 2);
  assert.ok(!out.some((p) => p.thirdPartyId === 'owner-self'));
});

test('reparto: suma >100 → 400', async () => {
  await assert.rejects(
    resolveParticipants(mkTx(), [
      { thirdPartyId: 'a', role: 'OTHER', sharePct: 70 },
      { thirdPartyId: 'b', role: 'OTHER', sharePct: 40 },
    ], CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});

test('reparto: más de MAX_PARTICIPANTS → 400', async () => {
  const six = Array.from({ length: MAX_PARTICIPANTS + 1 }, (_, i) => ({
    thirdPartyId: `tp-${i}`, role: 'OTHER', sharePct: 10,
  }));
  await assert.rejects(
    resolveParticipants(mkTx(), six, CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400 && /5/.test(e.message),
  );
});

test('reparto: thirdPartyId duplicado → 400', async () => {
  await assert.rejects(
    resolveParticipants(mkTx(), [
      { thirdPartyId: 'a', role: 'CAPTADOR', sharePct: 20 },
      { thirdPartyId: 'a', role: 'OTHER', sharePct: 20 },
    ], CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400 && /repetid/i.test(e.message),
  );
});

test('reparto: owner-self en las filas → 400 (su parte es el resto)', async () => {
  await assert.rejects(
    resolveParticipants(mkTx(), [
      { thirdPartyId: 'owner-self', role: 'OTHER', sharePct: 40 },
    ], CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});

test('reparto: sharePct <= 0 → 400', async () => {
  await assert.rejects(
    resolveParticipants(mkTx(), [{ thirdPartyId: 'a', role: 'OTHER', sharePct: 0 }], CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});

test('reparto: tercero inexistente → 400 con mensaje accionable', async () => {
  await assert.rejects(
    resolveParticipants(mkTx(['tp-borrado']), [
      { thirdPartyId: 'tp-borrado', role: 'OTHER', sharePct: 20 },
    ], CFG_LEGACY),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});

test('reparto: sin participants + equipo default → team + resto al dueño', async () => {
  const cfg = {
    ...CFG_LEGACY,
    defaultTeam: [
      { thirdPartyId: 'tp-vendedor', role: 'CAPTADOR', sharePct: 30 },
      { thirdPartyId: 'tp-papa', role: 'OTHER', sharePct: 15 },
    ],
  };
  const out = await resolveParticipants(mkTx(), undefined, cfg);
  assert.equal(out.length, 3);
  assert.equal(out.find((p) => p.thirdPartyId === 'owner-self').sharePct, 55);
});

test('reparto: equipo default con tercero borrado → 400 pidiendo actualizar Configuración', async () => {
  const cfg = { ...CFG_LEGACY, defaultTeam: [{ thirdPartyId: 'tp-borrado', role: 'OTHER', sharePct: 20 }] };
  await assert.rejects(
    resolveParticipants(mkTx(['tp-borrado']), undefined, cfg),
    (e) => e instanceof AppError && /Configuraci/i.test(e.message),
  );
});

test('reparto: sin participants y sin equipo → fallback legacy (owner captador+cerrador)', async () => {
  const out = await resolveParticipants(mkTx(), undefined, CFG_LEGACY);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => p.thirdPartyId === 'owner-self'));
  assert.deepEqual(out.map((p) => p.role).sort(), ['CAPTADOR', 'CERRADOR']);
  assert.equal(out.reduce((s, p) => s + p.sharePct, 0), 100);
});
```

- [ ] **Step 2: RED**

Run: `cd backend && node --test src/services/__tests__/commissionService.test.js`
Expected: FAIL — los tests nuevos fallan (contrato actual exige suma=100, no hay `MAX_PARTICIPANTS`, no hay resto-al-dueño).

- [ ] **Step 3: Implementación**

En `backend/src/services/commissionService.js` reemplazar `resolveParticipants` completo y extender `loadCommissionConfig`:

```js
const MAX_PARTICIPANTS = 5;
const OWNER_ID = 'owner-self';
const DEFAULT_TEAM_KEY = 'commission_default_team';
const SUM_TOLERANCE = 0.001;
```

`loadCommissionConfig`: leer `[...COMMISSION_CONFIG_KEYS, DEFAULT_TEAM_KEY]` en el `findMany`; el check de `missing` sigue SOLO sobre `COMMISSION_CONFIG_KEYS` (la key nueva es opcional). Al final:

```js
  let defaultTeam = null;
  if (cfg[DEFAULT_TEAM_KEY]) {
    try {
      const parsed = JSON.parse(cfg[DEFAULT_TEAM_KEY]);
      if (Array.isArray(parsed) && parsed.length > 0) defaultTeam = parsed;
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[commissionService] commission_default_team corrupto; se ignora (fallback legacy)');
    }
  }
  return { /* ...campos actuales... */, defaultTeam };
```

`resolveParticipants` nuevo:

```js
/**
 * Resuelve la lista FINAL de participantes de una venta (siempre suma 100):
 * 1. `saleParticipants` explícitos (edición por venta): máx 5, suma ≤ 100,
 *    sin duplicados, sin owner-self, sharePct > 0, terceros existentes.
 * 2. Sin explícitos → equipo default de Settings (cfg.defaultTeam), mismas
 *    reglas; si un tercero fue borrado, error accionable.
 * 3. Sin equipo → fallback legacy: owner-self captador+cerrador con los %
 *    default (comportamiento pre-equipo, intacto).
 * En 1 y 2, el resto (100 − suma) genera la fila del dueño (OWNER_ID, OTHER).
 */
async function resolveParticipants(prismaOrTx, saleParticipants, cfg) {
  const explicit = Array.isArray(saleParticipants) && saleParticipants.length > 0;
  const team = explicit ? saleParticipants : (cfg?.defaultTeam || null);

  if (!team) {
    // Fallback legacy — igual que antes del equipo de reparto.
    const owner = await prismaOrTx.thirdParty.findUnique({
      where: { id: OWNER_ID },
      select: { id: true },
    });
    if (!owner) {
      throw new AppError(
        'Tercero default "owner-self" no encontrado. ¿Falta correr la migración de comisiones?',
        500
      );
    }
    const captadorPct = cfg?.defaultCaptadorPct ?? 30;
    const cerradorPct = cfg?.defaultCerradorPct ?? 70;
    return [
      { thirdPartyId: OWNER_ID, role: 'CAPTADOR', sharePct: captadorPct },
      { thirdPartyId: OWNER_ID, role: 'CERRADOR', sharePct: cerradorPct },
    ];
  }

  const source = explicit ? 'participants' : 'el equipo de reparto';
  if (team.length > MAX_PARTICIPANTS) {
    throw new AppError(`Máximo ${MAX_PARTICIPANTS} personas en ${source} (sin contar al dueño)`, 400);
  }
  if (team.some((p) => p.thirdPartyId === OWNER_ID)) {
    throw new AppError('El dueño no va en las filas del reparto: su parte es el resto automático', 400);
  }
  if (team.some((p) => !(Number(p.sharePct) > 0))) {
    throw new AppError('Cada participante debe tener un porcentaje mayor a 0', 400);
  }
  const ids = team.map((p) => p.thirdPartyId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError('Hay participantes repetidos en el reparto', 400);
  }
  const sum = team.reduce((acc, p) => acc + Number(p.sharePct || 0), 0);
  if (sum > 100 + SUM_TOLERANCE) {
    throw new AppError(`Los porcentajes del reparto suman ${sum} (máximo 100)`, 400);
  }

  const found = await prismaOrTx.thirdParty.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const foundIds = new Set(found.map((f) => f.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new AppError(
      explicit
        ? `Terceros no encontrados: ${missing.join(', ')}`
        : `El equipo de reparto referencia terceros que ya no existen (${missing.join(', ')}); actualízalo en Configuración`,
      400
    );
  }

  const resolved = team.map((p) => ({
    thirdPartyId: p.thirdPartyId,
    role: p.role,
    sharePct: Number(p.sharePct),
  }));
  const remainder = 100 - sum;
  if (remainder > SUM_TOLERANCE) {
    resolved.push({ thirdPartyId: OWNER_ID, role: 'OTHER', sharePct: remainder });
  }
  return resolved;
}
```

Extender el export con `MAX_PARTICIPANTS` (y mantener todo lo existente).

- [ ] **Step 4: GREEN + suite**

Run: `cd backend && node --test src/services/__tests__/commissionService.test.js` → PASS (los 11 nuevos + previos).
Run: `cd backend && npm test` → PASS total.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/commissionService.js backend/src/services/__tests__/commissionService.test.js
git commit -m "feat(commissions): contrato de reparto — hasta 5 personas, resto al dueño, equipo default y fallback legacy"
```

---

### Task 2: Backend — `GET /commissions/summary` (TDD del armado puro)

**Files:**
- Modify: `backend/src/services/commissionService.js` (helper puro `buildPersonSummary` + `getSummary(prismaOrTx)`)
- Modify: `backend/src/controllers/commissionController.js` (handler `summary`)
- Modify: `backend/src/routes/commissions.js` (ruta `GET /summary` ANTES de `GET /`)
- Test: `backend/src/services/__tests__/commissionService.test.js`

**Interfaces:**
- Consumes: `dayKeyBogota` de `../utils/dates` (para el inicio de mes en zona negocio).
- Produces: `GET /api/commissions/summary` → `{ pendingTotal: number, paidThisMonth: number, byPerson: [{ thirdParty: {id,name}, totalPaid, totalPending, salesCount }] }` (byPerson ordenado por totalPending desc). Tasks 5/6 dependen de estos nombres. Helper puro `buildPersonSummary(rows)` donde `rows = [{ thirdPartyId, thirdPartyName, vehicleId, status, totalAmount, paidAmount }]`.

- [ ] **Step 1: Tests del armado puro (RED)**

```js
// ── buildPersonSummary (métricas por persona) ────────────────────
const { buildPersonSummary } = require('../commissionService');

test('summary: agrega por persona con pagado, pendiente y # ventas distintas', () => {
  const rows = [
    { thirdPartyId: 'v', thirdPartyName: 'Vendedor', vehicleId: 'car1', status: 'PAID', totalAmount: 900_000, paidAmount: 900_000 },
    { thirdPartyId: 'v', thirdPartyName: 'Vendedor', vehicleId: 'car2', status: 'PENDING', totalAmount: 600_000, paidAmount: 0 },
    { thirdPartyId: 'p', thirdPartyName: 'Papá', vehicleId: 'car1', status: 'PARTIAL', totalAmount: 450_000, paidAmount: 200_000 },
  ];
  const out = buildPersonSummary(rows);
  const v = out.find((x) => x.thirdParty.id === 'v');
  assert.equal(v.totalPaid, 900_000);
  assert.equal(v.totalPending, 600_000);
  assert.equal(v.salesCount, 2);
  const p = out.find((x) => x.thirdParty.id === 'p');
  assert.equal(p.totalPending, 250_000);
  // Orden: mayor pendiente primero
  assert.equal(out[0].thirdParty.id, 'v');
});

test('summary: CANCELLED no suma pendiente pero sí lo ya pagado', () => {
  const rows = [
    { thirdPartyId: 'v', thirdPartyName: 'V', vehicleId: 'c1', status: 'CANCELLED', totalAmount: 500_000, paidAmount: 100_000 },
  ];
  const out = buildPersonSummary(rows);
  assert.equal(out[0].totalPending, 0);
  assert.equal(out[0].totalPaid, 100_000);
});

test('summary: sin filas → lista vacía', () => {
  assert.deepEqual(buildPersonSummary([]), []);
});
```

- [ ] **Step 2: RED** — `buildPersonSummary is not a function`.

- [ ] **Step 3: Implementación**

En `commissionService.js`:

```js
// Armado puro de la métrica por persona (testeable sin DB).
function buildPersonSummary(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.thirdPartyId)) {
      byId.set(r.thirdPartyId, {
        thirdParty: { id: r.thirdPartyId, name: r.thirdPartyName },
        totalPaid: 0,
        totalPending: 0,
        vehicleIds: new Set(),
      });
    }
    const acc = byId.get(r.thirdPartyId);
    acc.totalPaid += Number(r.paidAmount || 0);
    if (r.status === 'PENDING' || r.status === 'PARTIAL') {
      acc.totalPending += Number(r.totalAmount || 0) - Number(r.paidAmount || 0);
    }
    acc.vehicleIds.add(r.vehicleId);
  }
  return [...byId.values()]
    .map(({ vehicleIds, ...rest }) => ({ ...rest, salesCount: vehicleIds.size }))
    .sort((a, b) => b.totalPending - a.totalPending);
}

/**
 * Agregados de comisiones para Dashboard + sección "Por persona".
 */
async function getSummary(prismaOrTx) {
  const payables = await prismaOrTx.payable.findMany({
    where: { type: 'COMMISSION', vehicleId: { not: null } },
    select: {
      thirdPartyId: true,
      vehicleId: true,
      status: true,
      totalAmount: true,
      paidAmount: true,
      thirdParty: { select: { name: true } },
    },
  });
  const rows = payables.map((p) => ({
    thirdPartyId: p.thirdPartyId,
    thirdPartyName: p.thirdParty?.name || '—',
    vehicleId: p.vehicleId,
    status: p.status,
    totalAmount: p.totalAmount,
    paidAmount: p.paidAmount,
  }));
  const byPerson = buildPersonSummary(rows);
  const pendingTotal = byPerson.reduce((s, p) => s + p.totalPending, 0);

  // Pagado este mes: pagos de CxP COMMISSION desde el día 1 en zona Bogotá.
  const todayKey = dayKeyBogota(new Date()); // YYYY-MM-DD
  const monthStart = new Date(`${todayKey.slice(0, 7)}-01T00:00:00-05:00`);
  const paidAgg = await prismaOrTx.payablePayment.aggregate({
    _sum: { amount: true },
    where: {
      createdAt: { gte: monthStart },
      payable: { type: 'COMMISSION' },
    },
  });

  return {
    pendingTotal,
    paidThisMonth: parseFloat(paidAgg._sum.amount || 0),
    byPerson,
  };
}
```

Import arriba: `const { dayKeyBogota } = require('../utils/dates');`. Exportar `buildPersonSummary` y `getSummary`.

Controller (`commissionController.js`):

```js
const summary = async (req, res, next) => {
  try {
    res.json(await commissionService.getSummary(prisma));
  } catch (err) { next(err); }
};
```
(y agregarlo al `module.exports`).

Ruta (`routes/commissions.js`), ANTES de `router.get('/', ...)`:

```js
router.get('/summary', ctrl.summary);
```

- [ ] **Step 4: GREEN + suite completa** — `npm test` PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/commissionService.js backend/src/services/__tests__/commissionService.test.js backend/src/controllers/commissionController.js backend/src/routes/commissions.js
git commit -m "feat(commissions): GET /commissions/summary — pendiente, pagado del mes (Bogotá) y métricas por persona"
```

---

### Task 3: Settings — equipo de reparto (backend + UI)

**Files:**
- Modify: `backend/src/middleware/validation.js` (campo `commission_default_team` en `commissionConfigSchema`)
- Modify: `backend/src/controllers/settingsController.js` (validaciones cruzadas + persistencia + hidratación en GET)
- Create: `frontend/src/components/treasury/CommissionSplitEditor.jsx`
- Modify: `frontend/src/pages/SettingsPage.jsx` (bloque "Equipo de reparto")

**Interfaces:**
- Consumes: contrato de Task 1 (mismas reglas de validación, `MAX_PARTICIPANTS`); `ThirdPartySelector` existente.
- Produces:
  - `GET /settings/commission-config` incluye `commission_default_team` (array parseado, `[]` si no existe) + `commission_default_team_people: [{id,name}]` (hidratación de nombres).
  - `PUT` acepta `commission_default_team` (array, puede ser `[]` para borrar el equipo).
  - Componente `CommissionSplitEditor({ value, onChange, testidPrefix })` con testids `${testidPrefix}-row-<i>-pct`, `${testidPrefix}-add`, `${testidPrefix}-remove-<i>`, `${testidPrefix}-owner-share`. Task 4 lo reutiliza; Task 6 usa los testids.

- [ ] **Step 1: Joi**

En `commissionConfigSchema` agregar:

```js
  commission_default_team: Joi.array().items(Joi.object({
    thirdPartyId: Joi.string().required(),
    role: Joi.string().valid('CAPTADOR', 'CERRADOR', 'OTHER').required(),
    sharePct: Joi.number().positive().max(100).required(),
  })).max(5).default([]),
```

- [ ] **Step 2: Controller PUT — validaciones cruzadas + persistencia**

En `updateCommissionConfig`, después de la validación de cuentas BUDGET y antes de persistir:

```js
    // 3b) Equipo de reparto (opcional): sin owner-self, sin duplicados,
    // suma ≤ 100, terceros existentes (mismo contrato que resolveParticipants).
    const team = Array.isArray(data.commission_default_team) ? data.commission_default_team : [];
    if (team.some((p) => p.thirdPartyId === 'owner-self')) {
      return res.status(400).json({ error: 'El dueño no va en el equipo: su parte es el resto automático' });
    }
    const teamIds = team.map((p) => p.thirdPartyId);
    if (new Set(teamIds).size !== teamIds.length) {
      return res.status(400).json({ error: 'Hay personas repetidas en el equipo de reparto' });
    }
    const teamSum = team.reduce((s, p) => s + Number(p.sharePct), 0);
    if (teamSum > 100.001) {
      return res.status(400).json({ error: `Los porcentajes del equipo suman ${teamSum} (máximo 100)` });
    }
    if (teamIds.length > 0) {
      const foundTps = await prisma.thirdParty.findMany({ where: { id: { in: teamIds } }, select: { id: true } });
      if (foundTps.length !== teamIds.length) {
        return res.status(400).json({ error: 'Algún tercero del equipo no existe' });
      }
    }
```

En la persistencia: el valor de `commission_default_team` se guarda `JSON.stringify(team)` (ajustar el map de upserts: `value: key === 'commission_default_team' ? JSON.stringify(value) : String(value)`).

En `getCommissionConfig`: incluir la key en el `findMany` (agregarla al array `in`), parsear defensivo a array (`[]` si falta/corrupto) y devolver `commission_default_team` (array) + hidratar nombres:

```js
    let team = [];
    try { team = JSON.parse(result.commission_default_team || '[]'); } catch { team = []; }
    if (!Array.isArray(team)) team = [];
    result.commission_default_team = team;
    if (team.length > 0) {
      const people = await prisma.thirdParty.findMany({
        where: { id: { in: team.map((t) => t.thirdPartyId) } },
        select: { id: true, name: true },
      });
      result.commission_default_team_people = people;
    } else {
      result.commission_default_team_people = [];
    }
```

- [ ] **Step 3: Componente compartido**

Crear `frontend/src/components/treasury/CommissionSplitEditor.jsx`:

```jsx
// ═══════════════════════════════════════════════════════════════
// CommissionSplitEditor — filas de reparto de comisión (persona+rol+%)
// Compartido entre Settings (equipo default) y SalePaymentModal (por venta).
// La parte del dueño es SIEMPRE el resto: se muestra en vivo, no es fila.
// ═══════════════════════════════════════════════════════════════

import ThirdPartySelector from '@/components/shared/ThirdPartySelector';
import { Plus, X } from 'lucide-react';

const MAX_PEOPLE = 5;
const ROLES = [
  { id: 'CAPTADOR', label: 'Captador' },
  { id: 'CERRADOR', label: 'Cerrador' },
  { id: 'OTHER', label: 'Otro' },
];

export default function CommissionSplitEditor({ value = [], onChange, testidPrefix }) {
  const sum = value.reduce((s, r) => s + (parseFloat(r.sharePct) || 0), 0);
  const ownerShare = Math.round((100 - sum) * 100) / 100;

  const setRow = (i, patch) => {
    const next = value.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const addRow = () => onChange([...value, { thirdPartyId: '', role: 'OTHER', sharePct: '' }]);
  const removeRow = (i) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {value.map((row, i) => (
        <div key={i} className="grid grid-cols-[1fr_110px_70px_28px] gap-2 items-end">
          <ThirdPartySelector
            value={row.thirdPartyId}
            onChange={(id) => setRow(i, { thirdPartyId: id })}
            label={i === 0 ? 'Persona' : undefined}
            placeholder="Seleccionar..."
          />
          <div>
            {i === 0 && <label className="block text-sm text-[#8B949E] mb-1">Rol</label>}
            <select
              value={row.role}
              onChange={(e) => setRow(i, { role: e.target.value })}
              className="input w-full"
            >
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div>
            {i === 0 && <label className="block text-sm text-[#8B949E] mb-1">%</label>}
            <input
              type="number" min="1" max="100"
              value={row.sharePct}
              onChange={(e) => setRow(i, { sharePct: e.target.value })}
              className="input w-full"
              data-testid={`${testidPrefix}-row-${i}-pct`}
            />
          </div>
          <button
            type="button"
            onClick={() => removeRow(i)}
            className="btn-ghost p-1 text-red-400 hover:text-red-300"
            aria-label="Quitar persona"
            data-testid={`${testidPrefix}-remove-${i}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={addRow}
          disabled={value.length >= MAX_PEOPLE}
          className="btn-ghost text-xs inline-flex items-center gap-1 disabled:opacity-40"
          data-testid={`${testidPrefix}-add`}
        >
          <Plus className="w-3.5 h-3.5" /> Agregar persona ({value.length}/{MAX_PEOPLE})
        </button>
        <span
          className={`text-sm font-semibold ${ownerShare < 0 ? 'text-red-400' : 'text-[#3FB950]'}`}
          data-testid={`${testidPrefix}-owner-share`}
        >
          Tu parte: {ownerShare}%
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: SettingsPage — bloque "Equipo de reparto"**

En `frontend/src/pages/SettingsPage.jsx`: importar el editor; `commCfg.commission_default_team` ya llega como array del GET. Insertar dentro de la card de comisiones, entre el grid de captador/cerrador default y la línea de cuentas:

```jsx
              <div className="border-t border-border pt-3">
                <div className="text-sm font-semibold text-[#E6EDF3] mb-1">Equipo de reparto</div>
                <p className="text-xs text-[#6E7681] mb-2">
                  Personas que reciben parte del bolsillo de comisión en cada venta (máx 5).
                  Tu parte es el resto, automática. Puedes ajustarlo por venta al vender.
                </p>
                <CommissionSplitEditor
                  value={commCfg.commission_default_team || []}
                  onChange={(team) => setCommCfg({ ...commCfg, commission_default_team: team })}
                  testidPrefix="settings-team"
                />
              </div>
```

`handleSaveCommissions` ya envía `commCfg` completo — verificar que incluye `commission_default_team` (llegó en el GET, viaja de vuelta) y que filas con `thirdPartyId` vacío o pct vacío se filtran antes del PUT:

```jsx
      const teamClean = (commCfg.commission_default_team || [])
        .filter((r) => r.thirdPartyId && parseFloat(r.sharePct) > 0)
        .map((r) => ({ thirdPartyId: r.thirdPartyId, role: r.role, sharePct: Number(r.sharePct) }));
      await api.put('/settings/commission-config', { ...commCfg, commission_default_team: teamClean, commission_default_team_people: undefined, reinvest_account: undefined, tax_reserve_account: undefined });
```

- [ ] **Step 5: Build + suite**

Run: `cd frontend && npm run build` → OK. `cd backend && npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/middleware/validation.js backend/src/controllers/settingsController.js frontend/src/components/treasury/CommissionSplitEditor.jsx frontend/src/pages/SettingsPage.jsx
git commit -m "feat(commissions): equipo de reparto default en Settings (Setting JSON + editor compartido)"
```

---

### Task 4: SalePaymentModal — editor dinámico por venta

**Files:**
- Modify: `frontend/src/components/treasury/SalePaymentModal.jsx`

**Interfaces:**
- Consumes: `CommissionSplitEditor` (Task 3); `GET /settings/commission-config` (ya se consulta en `loadData`) que ahora trae `commission_default_team` como array.
- Produces: payload `saleData.participants = [{thirdPartyId, role, sharePct}]` SOLO si el usuario tocó el editor (contrato intacto: sin tocar → sin `participants`). Testids del editor con prefix `sale-split` (Task 6).

- [ ] **Step 1: Reemplazar el estado del par fijo**

Sustituir el estado `commission`/`commissionOpen`/`commissionTouched` actual por:

```jsx
  // Reparto de comisión: editor dinámico (default: equipo de Settings).
  // touched=false → el payload no manda participants (default backend).
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitTouched, setSplitTouched] = useState(false);
  const [split, setSplit] = useState([]);          // filas actuales del editor
  const [defaultTeam, setDefaultTeam] = useState([]); // lo que llegó de settings
```

En `loadData()` (donde hoy se leen los pcts default):

```jsx
      const cfgRes = await api.get('/settings/commission-config').catch(() => null);
      const team = Array.isArray(cfgRes?.data?.commission_default_team)
        ? cfgRes.data.commission_default_team
        : [];
      setDefaultTeam(team);
      setSplit(team);
```

En `resetForm()`: `setSplitOpen(false); setSplitTouched(false); setSplit(defaultTeam);`

- [ ] **Step 2: Validación + payload**

Reemplazar la validación del par fijo por:

```jsx
    if (splitTouched) {
      const clean = split.filter((r) => r.thirdPartyId || parseFloat(r.sharePct) > 0);
      if (clean.some((r) => !r.thirdPartyId || !(parseFloat(r.sharePct) > 0))) {
        newErrors.commission = 'Cada fila del reparto necesita persona y % mayor a 0';
      } else {
        const ids = clean.map((r) => r.thirdPartyId);
        const sum = clean.reduce((s, r) => s + parseFloat(r.sharePct), 0);
        if (new Set(ids).size !== ids.length) newErrors.commission = 'Hay personas repetidas en el reparto';
        else if (sum > 100.001) newErrors.commission = `El reparto suma ${sum}% (máximo 100; tu parte es el resto)`;
      }
    }
```

Y el payload (reemplaza el bloque `participants` actual):

```jsx
    if (splitTouched) {
      saleData.participants = split
        .filter((r) => r.thirdPartyId && parseFloat(r.sharePct) > 0)
        .map((r) => ({ thirdPartyId: r.thirdPartyId, role: r.role, sharePct: Number(r.sharePct) }));
    }
```

(Si el usuario tocó y dejó el editor vacío → `participants: []` NO debe viajar: si el array queda vacío, omitir la clave para caer al default backend.)

```jsx
      if (saleData.participants && saleData.participants.length === 0) delete saleData.participants;
```

- [ ] **Step 3: UI**

Reemplazar la sección colapsada actual por:

```jsx
          {/* Reparto de comisión (default: equipo de Settings) */}
          <div className="border border-border rounded-lg p-3">
            <button
              type="button"
              onClick={() => setSplitOpen(o => !o)}
              className="w-full flex items-center gap-2 text-sm font-semibold text-[#8B949E] hover:text-[#E6EDF3]"
              data-testid="sale-commission-toggle"
            >
              {splitOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Comisión — Reparto (default: tu equipo)
            </button>
            {splitOpen && (
              <div className="mt-3 space-y-3">
                <CommissionSplitEditor
                  value={split}
                  onChange={(rows) => { setSplit(rows); setSplitTouched(true); }}
                  testidPrefix="sale-split"
                />
                {errors.commission && (
                  <p className="text-[11px] text-red-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errors.commission}</p>
                )}
              </div>
            )}
          </div>
```

Eliminar del archivo las dos filas fijas captador/cerrador y su estado (ya reemplazados). Import del editor arriba.

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build` → OK.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/treasury/SalePaymentModal.jsx
git commit -m "feat(ui): reparto dinámico de comisión en la venta (editor compartido, default equipo)"
```

---

### Task 5: Métricas — sección "Por persona" + card del Dashboard

**Files:**
- Modify: `frontend/src/lib/payablesApi.js` (`commissionsApi.getSummary`)
- Modify: `frontend/src/pages/treasury/CommissionsPage.jsx` (sección "Por persona")
- Modify: `frontend/src/pages/DashboardPage.jsx` (card Comisiones)

**Interfaces:**
- Consumes: `GET /api/commissions/summary` (Task 2).
- Produces: testids `commissions-by-person`, `commissions-person-<thirdPartyId>`, `dashboard-commissions-card` (Task 6).

- [ ] **Step 1: Cliente**

En `payablesApi.js`, dentro de `commissionsApi`:

```js
  getSummary: () => api.get('/commissions/summary'),
```

- [ ] **Step 2: CommissionsPage — sección "Por persona"**

Estado y carga (junto al `load()` existente):

```jsx
  const [summary, setSummary] = useState(null);
```
En `load()`, junto al fetch actual:
```jsx
      const [{ data }, sumRes] = await Promise.all([
        commissionsApi.getAll(),
        commissionsApi.getSummary().catch(() => null),
      ]);
      setItems(data || []);
      setSummary(sumRes?.data || null);
```

Render, entre los KPIs y las cards de pendientes:

```jsx
      {/* Por persona */}
      {summary?.byPerson?.length > 0 && (
        <section className="card p-4" data-testid="commissions-by-person">
          <h3 className="text-sm font-semibold text-[#E6EDF3] mb-2">Por persona</h3>
          <div className="space-y-1.5">
            {summary.byPerson.map((p) => (
              <div
                key={p.thirdParty.id}
                className="flex items-center justify-between text-sm border-t border-border/50 pt-1.5 first:border-0 first:pt-0"
                data-testid={`commissions-person-${p.thirdParty.id}`}
              >
                <span className="text-[#E6EDF3]">{p.thirdParty.name}
                  <span className="text-[#6E7681] ml-1.5 text-xs">({p.salesCount} {p.salesCount === 1 ? 'venta' : 'ventas'})</span>
                </span>
                <span className="font-mono text-xs">
                  <span className="text-green-400">{formatCurrency(p.totalPaid)} pagado</span>
                  <span className="text-[#6E7681]"> · </span>
                  <span className={p.totalPending > 0 ? 'text-amber-400' : 'text-[#6E7681]'}>{formatCurrency(p.totalPending)} pendiente</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
```

- [ ] **Step 3: Dashboard — card Comisiones**

En `DashboardPage.jsx`: importar `useNavigate` (verificar si ya está) y `commissionsApi`; estado + fetch:

```jsx
  const [commSummary, setCommSummary] = useState(null);
  useEffect(() => {
    commissionsApi.getSummary().then(r => setCommSummary(r.data)).catch(() => {});
  }, []);
```

Card clicable junto a los KPIs existentes (después del grid de `kpiCards`):

```jsx
      {commSummary && (
        <button
          type="button"
          onClick={() => navigate('/treasury/commissions')}
          className="kpi-card w-full text-left hover:border-accent/40 transition-colors cursor-pointer"
          data-testid="dashboard-commissions-card"
        >
          <div className="text-[11px] text-[#6E7681] uppercase tracking-wider">Comisiones</div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span className="text-xl font-bold font-mono text-amber-400">{formatCurrency(commSummary.pendingTotal)}</span>
            <span className="text-[11px] text-[#6E7681]">pendientes</span>
          </div>
          <div className="text-[11px] text-[#8B949E] mt-0.5">
            Pagado este mes: <span className="font-mono text-green-400">{formatCurrency(commSummary.paidThisMonth)}</span> →
          </div>
        </button>
      )}
```

(Si `navigate` no existe en DashboardPage, agregar `const navigate = useNavigate();` con su import de react-router-dom.)

- [ ] **Step 4: Build + commit**

Run: `cd frontend && npm run build` → OK.

```bash
git add frontend/src/lib/payablesApi.js frontend/src/pages/treasury/CommissionsPage.jsx frontend/src/pages/DashboardPage.jsx
git commit -m "feat(ui): métricas de comisiones — sección Por persona y card del Dashboard con navegación"
```

---

### Task 6: E2E + verificación final

**Files:**
- Create: `tests/e2e/treasury/commission-split-team.spec.ts`
- Modify (si hace falta): `tests/helpers/api.ts` (helper `apiGetCommissionsSummary`)

**Interfaces:**
- Consumes: testids de Tasks 3-5; helpers `apiPinLogin`, `apiCreateVehicle`, `apiRegisterSale`, `apiUpdateCommissionConfig`, `apiGetCommissionConfig`, `apiListCommissions`, `apiRequestRaw`, `TEST_SEED_IDS` (`employee`, `supplier`, `buyer`, `accountCash`).

- [ ] **Step 1: Helper + spec**

Helper en `tests/helpers/api.ts`:

```ts
export async function apiGetCommissionsSummary(token: string): Promise<{
  pendingTotal: number;
  paidThisMonth: number;
  byPerson: Array<{ thirdParty: { id: string; name: string }; totalPaid: number; totalPending: number; salesCount: number }>;
}> {
  return getJson('/commissions/summary', token);
}
```

Spec `tests/e2e/treasury/commission-split-team.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiPinLogin,
  apiCreateVehicle,
  apiRegisterSale,
  apiUpdateCommissionConfig,
  apiListCommissions,
  apiGetCommissionsSummary,
  apiRequestRaw,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

const BASE_CFG = {
  commission_share_pct: 60,
  reinvest_share_pct: 30,
  tax_share_pct: 10,
  default_captador_pct: 30,
  default_cerrador_pct: 70,
  reinvest_account_id: 'budget-reinvest',
  tax_reserve_account_id: 'budget-tax',
};

async function setTeam(token: string, team: Array<{ thirdPartyId: string; role: string; sharePct: number }>) {
  const res = await apiUpdateCommissionConfig(token, { ...BASE_CFG, commission_default_team: team });
  expect(res.status).toBe(200);
}

async function sellCar(token: string, participants?: Array<{ thirdPartyId: string; role: string; sharePct: number }>) {
  const v = await apiCreateVehicle(token, {
    plate: plate('TEA'),
    stage: 'COMPRADO',
    negotiatedValue: 30_000_000,
    purchasePrice: 30_000_000,
    listedPrice: 40_000_000,
    supplierId: TEST_SEED_IDS.supplier,
  });
  await apiRegisterSale(token, v.id, {
    salePrice: 40_000_000,
    paymentType: 'CASH',
    buyerId: TEST_SEED_IDS.buyer,
    cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 40_000_000 },
    ...(participants ? { participants } : {}),
  });
  return v;
}

test.describe('Comisiones — equipo de reparto + métricas', () => {
  test('venta sin tocar aplica el equipo default y el dueño recibe el resto', async () => {
    const token = await apiPinLogin();
    await setTeam(token, [
      { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
      { thirdPartyId: TEST_SEED_IDS.partner, role: 'OTHER', sharePct: 15 },
    ]);
    const v = await sellCar(token);

    const items = await apiListCommissions(token);
    const item = items.find((i) => i.vehicle.plate === v.plate)!;
    expect(item.roles.length).toBe(3); // empleado + partner + dueño (resto 55%)
    const owner = item.roles.find((r) => r.thirdParty.id === 'owner-self')!;
    expect(owner.sharePct).toBe(55);
    // bolsillo 60% de 10M = 6M; dueño 55% de 6M = 3.3M
    expect(owner.total).toBe(3_300_000);
  });

  test('reparto que suma 100 no genera fila del dueño; >5 personas es 400', async () => {
    const token = await apiPinLogin();
    await setTeam(token, []); // sin equipo para aislar
    const v = await sellCar(token, [
      { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 60 },
      { thirdPartyId: TEST_SEED_IDS.partner, role: 'CERRADOR', sharePct: 40 },
    ]);
    const items = await apiListCommissions(token);
    const item = items.find((i) => i.vehicle.plate === v.plate)!;
    expect(item.roles.length).toBe(2);
    expect(item.roles.some((r) => r.thirdParty.id === 'owner-self')).toBe(false);

    // 6 personas → 400 (usar terceros seed repetibles no vale: crear 6 dummies)
    const six = [];
    for (let i = 0; i < 6; i++) {
      const created = await apiRequestRaw('POST', '/treasury/third-parties', token, {
        name: `Split6 ${Date.now()}-${i}`, type: 'EMPLOYEE',
      });
      six.push({ thirdPartyId: (created.body as { id: string }).id, role: 'OTHER', sharePct: 10 });
    }
    const veh = await apiCreateVehicle(token, {
      plate: plate('SIX'), stage: 'COMPRADO', negotiatedValue: 10_000_000,
      purchasePrice: 10_000_000, listedPrice: 12_000_000, supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRequestRaw('POST', `/vehicles/${veh.id}/sell`, token, {
      salePrice: 12_000_000, paymentType: 'CASH', buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 12_000_000 },
      participants: six,
    });
    expect(res.status).toBe(400);
  });

  test('summary por persona + dashboard card navega a comisiones', async ({ page }) => {
    const token = await loginAsAdmin(page);
    await setTeam(token, [
      { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
    ]);
    await sellCar(token);

    const summary = await apiGetCommissionsSummary(token);
    const emp = summary.byPerson.find((p) => p.thirdParty.id === TEST_SEED_IDS.employee)!;
    expect(emp.totalPending).toBeGreaterThan(0);
    expect(emp.salesCount).toBe(1);
    expect(summary.pendingTotal).toBeGreaterThan(0);

    // Dashboard: card visible y navega
    await page.goto('/dashboard');
    const card = page.getByTestId('dashboard-commissions-card');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/treasury\/commissions/);
    await expect(page.getByTestId('commissions-by-person')).toBeVisible();
    await expect(page.getByTestId(`commissions-person-${TEST_SEED_IDS.employee}`)).toBeVisible();
  });
});
```

Nota: verificar la ruta real del Dashboard en `frontend/src/App.jsx` (si es `/dashboard` u otra) y ajustar el `page.goto`. Si `apiUpdateCommissionConfig` no acepta el campo nuevo en su tipo TS, extender el tipo del helper.

- [ ] **Step 2: Correr los e2e nuevos**

Run: `npx playwright test tests/e2e/treasury/commission-split-team.spec.ts --reporter=list`
Expected: 3 passed (puertos 4000/5173 libres).

- [ ] **Step 3: Verificación completa**

Run: `cd backend && npm test` → PASS total.
Run: `cd frontend && npm run build` → OK.
Run: `npx playwright test tests/e2e/treasury/ tests/e2e/sales/commissions.spec.ts --reporter=list` → sin regresiones (en particular los specs de comisiones Fase 1/2: el fallback legacy debe mantenerlos verdes).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/treasury/commission-split-team.spec.ts tests/helpers/api.ts
git commit -m "test(e2e): equipo de reparto — default aplicado, límites del contrato y métricas por persona + dashboard"
```

---

## Self-Review (hecha al escribir)

- **Cobertura del spec:** contrato de reparto → Task 1; summary/pendiente/pagado-mes-Bogotá/byPerson → Task 2; Settings (Joi+controller+editor+UI) → Task 3; modal de venta → Task 4; Por persona + Dashboard card → Task 5; e2e de los 3 flujos aprobados → Task 6. Casos borde: JSON corrupto (T1 loadCommissionConfig), tercero borrado del equipo (T1 test), suma 100 sin fila dueño (T1+T6), >5/duplicados/owner-self (T1+T3+T6), fallback legacy (T1 test + regresión commissions.spec en T6), summary vacío (T2 test lista vacía + card con ceros).
- **Placeholders:** ninguno.
- **Consistencia:** `resolveParticipants(prismaOrTx, saleParticipants, cfg)` misma firma que usa `saleService` hoy (sin cambios allí); `cfg.defaultTeam` producido en T1 y consumido en T1; `getSummary`/`buildPersonSummary` de T2 consumidos en T5/T6 con los mismos nombres de campos; testids de T3/T4/T5 usados en T6; `commission_default_team` mismo nombre en Joi/controller/GET/UI/payload.
