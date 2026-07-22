# Widget "Socios: pendientes" — ganancia por pagar y comisión por cobrar

**Fecha:** 2026-07-21
**Rama:** `feat/ganancia-inversionistas` (PR #54 → `dev`)
**Depende de:** el modelo de socio de venta (PARTNER_SHARE + CxC "Comisión socio venta") y el enrutamiento a cuenta socio de FASE B.

---

## 1. Problema

Cuando una venta tiene socio (externo por % o inversionista al 100%), quedan dos obligaciones por vehículo que hoy solo se ven entrando al detalle de cada carro:

- la **ganancia que hay que pagarle al socio** (CxP `PARTNER_SHARE`), y
- la **comisión que el socio le adeuda al fondo** (CxC `RECEIVABLE` "Comisión socio venta").

No hay una vista consolidada. El usuario quiere un widget —tipo notificación, a la vista en Tesorería y Dashboard— que muestre qué vehículos tienen ganancia de socio por pagar y comisión de socio por cobrar, sin recorrer carro por carro.

## 2. Alcance

**Incluye (pendiente = status PENDING o PARTIAL):**
- **Ganancia por pagar:** CxP `type: 'PARTNER_SHARE'` (descripción "Ganancia socio venta {placa}"). Cubre socio externo por % y socio-inversionista al 100% — ambos generan esta CxP.
- **Comisión por cobrar:** CxC `type: 'RECEIVABLE'` cuya descripción empieza con "Comisión socio venta".

**Fuera de alcance:**
- `PROFIT_SHARE` (reparto del fondo a inversionistas) — ya tiene su propia tarjeta en el dashboard.
- La CxC de venta ("Venta vehículo …") — no es del socio.
- Marcar/distinguir visualmente "externo %" vs "inversionista 100%": el dato (las CxP/CxC) es idéntico; basta mostrar el nombre del socio (YAGNI).

## 3. Backend — endpoint dedicado

**Ruta:** `GET /api/payables/socio-pending` (en `backend/src/routes/payables.js`, que ya está montado en `/payables`; sin parámetros). **Debe registrarse ANTES de `/:id`** (junto a `/summary` y `/upcoming`), o Express lo capturaría como `id='socio-pending'`. Estas rutas de payables llaman al service directamente en el handler y responden con `res.json(result)` — **sin envelope `{success,data}`** (mismo estilo que `/summary` y `/upcoming`), no hay archivo controller.

**Service:** `payableService.getSocioPending()`.

Constante nueva en `payableService.js`:
```js
const SOCIO_COMMISSION_PREFIX = 'Comisión socio venta';
```
(La ganancia se filtra por `type`, no por prefijo. El prefijo solo distingue la CxC de comisión del socio de la CxC de venta "Venta vehículo", mismo patrón que `isSaleReceivable` en saleService.)

**Consultas (dos `findMany` con `status: { in: ['PENDING','PARTIAL'] }`):**
- profit: `{ type: 'PARTNER_SHARE', status: {...} }`
- commission: `{ type: 'RECEIVABLE', description: { startsWith: SOCIO_COMMISSION_PREFIX }, status: {...} }`

Ambas con `include: { vehicle: { select: { id, plate, brand, model } }, thirdParty: { select: { id, name } } }`, ordenadas por `createdAt` ascendente (más antiguo primero, como los otros widgets).

**Respuesta (objeto crudo vía `res.json`, sin envelope):**
```json
{
  "profit":     { "total": <int>, "count": <int>, "items": [ Item, ... ] },
  "commission": { "total": <int>, "count": <int>, "items": [ Item, ... ] }
}
```
`Item = { id, vehicleId, vehicle: { id, plate, brand, model } | null, thirdParty: { id, name } | null, totalAmount, paidAmount, pending }` donde `pending = totalAmount - paidAmount` (COP entero). `total` de cada bucket = suma de `pending` de sus items; `count` = número de items. En el frontend se lee como `response.data.profit` / `response.data.commission` (axios).

Sin cambios de schema ni migraciones.

## 4. Frontend — `SocioPendingWidget` (autocontenido)

**Archivo:** `frontend/src/components/treasury/SocioPendingWidget.jsx`. Export default del componente.

**Datos:** hace su propio fetch a `payablesApi.getSocioPending()` al montar (patrón contenedor: fetch + render + modal + refetch). Expone una función `reload()` interna que se llama tras un pago/cobro exitoso.

**Render:**
- **Si `profit.count === 0 && commission.count === 0` → devuelve `null`** (no ocupa espacio; se comporta como notificación). Igual mientras `loading` inicial sin datos previos: no muestra esqueleto intrusivo (puede devolver `null` hasta tener respuesta).
- Tarjeta única (`card`) titulada "Socios: pendientes" con dos secciones, renderizando una sección solo si su `count > 0`:
  - **"Ganancia por pagar"** — acento rojo (egreso), ícono `ArrowUpRight`; total de la sección + filas.
  - **"Comisión por cobrar"** — acento verde (ingreso), ícono `ArrowDownLeft`; total + filas.
- Cada fila: ícono `Car`, placa (mono), "{brand} {model} · {socio.name}", y el `pending` a la derecha. Muestra hasta 5 filas por sección; si hay más, "+N más…".
- Estilo/tokens: reutiliza las clases del proyecto (`card`, `bg-surface-hover`, colores usados en `PayablesWidget`).

**Interacción (clic en una fila → abre `PaymentModal`):**
- Ganancia (PARTNER_SHARE): `PaymentModal` con `type='expense'`, `title='Pagar ganancia socio'`, `totalAmount`/`paidAmount` del item, `thirdPartyId={item.thirdParty.id}` (para que el modal muestre "Entra a: Cuenta Socio — …" y oculte SOCIO del origen, vía FASE B).
- Comisión (RECEIVABLE): `PaymentModal` con `type='income'`, `title='Cobrar comisión socio'`. Sin `thirdPartyId` de enrutamiento (el cobro entra a una cuenta de la empresa).
- `onSubmit` → `payablesApi.addPayment(item.id, paymentData)`. En éxito: cerrar modal + `reload()`. En error: mostrar el mensaje (toast/estado de error del proyecto) y no cerrar.

**Montaje:**
- `TreasuryPage`: junto al bloque de tarjetas CxC/CxP (arriba o inmediatamente después). Como se auto-oculta, no deja hueco cuando no hay pendientes.
- `DashboardPage`: en la zona de tesorería (cerca de los resúmenes de comisiones/inversionistas).
- Ambas páginas solo renderizan `<SocioPendingWidget />`; el componente se encarga de todo.

**API client:** `payablesApi.getSocioPending()` en `frontend/src/lib/payablesApi.js` → `GET /treasury/payables/socio-pending`. `addPayment` ya existe.

## 5. Manejo de errores

- Fetch del widget: en error → `console.error` y tratar como "sin datos" (el widget no se rompe; devuelve `null` o mantiene el último dato).
- Pago/cobro: error del backend (p. ej. saldo insuficiente, 400 de FASE B por origen=cuenta socio) → surfacear el mensaje al usuario mediante el mecanismo estándar (toast) y mantener el modal abierto.

## 6. Testing

**Unit backend (`payableService.getSocioPending`)** — fake prisma:
1. Devuelve en `profit.items` las CxP `PARTNER_SHARE` PENDING/PARTIAL; `commission.items` las RECEIVABLE con prefijo "Comisión socio venta".
2. Excluye PAID y CANCELLED de ambos buckets.
3. Excluye la CxC de venta ("Venta vehículo …") del bucket de comisión (aunque sea RECEIVABLE).
4. `total`/`count`/`pending` correctos (pending = totalAmount − paidAmount; total = suma de pendings).
5. Buckets vacíos → `{ total:0, count:0, items:[] }` (no rompe).

**E2E (Playwright, API-driven)** — extiende el flujo socio existente:
- Venta con socio → `GET /treasury/payables/socio-pending` lista el vehículo en `profit` y en `commission` con los montos esperados.
- Pagar la CxP `PARTNER_SHARE` → el vehículo desaparece de `profit`.
- Cobrar la CxC de comisión → el vehículo desaparece de `commission`.

**Frontend:** cubierto por el E2E (no hay runner de unit de frontend); verificación de build.

## 7. Archivos afectados

- `backend/src/services/payableService.js` — `getSocioPending()` + `SOCIO_COMMISSION_PREFIX`; export.
- `backend/src/routes/payables.js` — ruta `GET /socio-pending` (antes de `/:id`), handler llama al service y `res.json(result)`. Sin controller.
- `backend/src/services/__tests__/payableService.socioPending.test.js` — unit.
- `frontend/src/lib/payablesApi.js` — `getSocioPending()`.
- `frontend/src/components/treasury/SocioPendingWidget.jsx` — componente.
- `frontend/src/components/treasury/index.js` — export del componente.
- `frontend/src/pages/treasury/TreasuryPage.jsx` y `frontend/src/pages/DashboardPage.jsx` — montaje.
- E2E: `tests/e2e/treasury/socio.spec.ts` (o spec nuevo) + helper `apiGetSocioPending` en `tests/helpers/api.ts`.
