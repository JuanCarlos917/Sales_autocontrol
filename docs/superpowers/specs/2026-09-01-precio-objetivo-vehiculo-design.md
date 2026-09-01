# Precio objetivo de venta por vehículo (Proyector de venta)

**Fecha:** 2026-09-01
**Estado:** Diseño aprobado — pendiente de implementación
**Autor:** Juan Gomez

## Problema

Hoy el sistema tiene dos precios por vehículo:

- `listedPrice` — el precio al que efectivamente se publica.
- `salePrice` — el precio al que se vende.

`calculateVehicleMetrics` ya calcula una "ganancia proyectada" usando `listedPrice`,
pero eso responde *"¿cuánto ganaría si vendo al precio publicado?"*, no
*"¿a cuánto **debería** vender este carro para que la empresa sea rentable y crezca?"*.

No existe un **precio objetivo** derivado de una meta de rentabilidad. Sin él:

- No se puede saber, de un vistazo, si un carro está publicado por encima o por
  debajo de lo que la empresa necesita para crecer.
- No hay una lectura agregada del inventario que diga si el pipeline actual
  alcanza la meta de ganancia.

## Objetivo

Introducir un **precio objetivo (target)** por vehículo, calculado como
`costo total vivo × (1 + margen objetivo)`, separado de `listedPrice` y
`salePrice`. Con él:

1. **Semáforo por vehículo** — comparar el precio de referencia (publicado, o
   vendido) contra el target: cumple meta / rentable pero bajo meta / no cubre.
2. **Brecha por vehículo** — cuánto falta (o sobra) frente al target.
3. **Meta agregada del inventario** — suma de targets del inventario activo vs.
   lo publicado, para leer si el pipeline alcanza la meta de rentabilidad.

## Decisiones de diseño (cerradas)

| Decisión | Elección |
|---|---|
| Definición del margen | **Global con override por vehículo**: un default configurable, sobreescribible por vehículo. |
| Medida del agregado | **Suma de targets del inventario activo** vs. publicado. Sin meta mensual externa (fase 2). |
| Base del porcentaje | **Markup sobre costo**: `target = costo × (1 + margen)`. Coincide con el `roi` existente. |
| Base de costo | **Costo vivo actual** (`realCostWithFixed`): compra + gastos registrados + fijos prorrateados por días reales. El target sube mientras el carro no se vende → presiona a venderlo rápido. |

## Fuera de alcance (YAGNI — fase 2)

- Meta mensual/trimestral externa configurable en COP.
- Segmentación del margen por gama o rango de precio.
- Reserva/colchón de gastos pendientes en la base de costo.
- Histórico de cumplimiento del target a lo largo del tiempo.

Ninguno de estos rompe el diseño actual; todos son aditivos.

## Modelo de datos

### `Setting` (ya existe, tabla key/value)

Nueva key:

- `targetMarginDefault` — string decimal, ej. `"0.15"` (15 %). Mismo patrón que
  la key `fixedMonthly` existente. Si no está presente, se usa un default de
  código (ver constante abajo).

### `Vehicle`

Un campo nuevo:

```prisma
targetMargin  Decimal? @db.Decimal(5, 4)  // override del margen objetivo; null = usa targetMarginDefault global
```

- `null` → el vehículo usa el margen global.
- Con valor (0–1) → override específico de ese vehículo.

El **target price no se almacena**: se calcula on-the-fly a partir del costo vivo
y el margen efectivo. Almacenarlo generaría datos rancios cuando cambien los
gastos, el gasto fijo o el margen.

### Migración

`npx prisma migrate dev` añadiendo la columna `targetMargin` (nullable, sin
default → no requiere backfill). Invocar la skill `database-migrations` antes de
generar la migración.

## Cálculo

Toda la lógica vive en `backend/src/utils/financial.js`. Se define una constante:

```js
const DEFAULT_TARGET_MARGIN = 0.15; // fallback si no hay Setting targetMarginDefault
```

### `calculateVehicleMetrics`

Firma actualizada — se añade `targetMarginDefault` como parámetro con default:

```js
function calculateVehicleMetrics(
  vehicle,
  fixedMonthly = 800000,
  commissionPayables = [],
  targetMarginDefault = DEFAULT_TARGET_MARGIN,
) { ... }
```

Nuevos campos en el objeto de métricas retornado:

```
effectiveMargin = vehicle.targetMargin != null ? Number(vehicle.targetMargin) : targetMarginDefault
targetPrice     = round(realCostWithFixed × (1 + effectiveMargin))
targetProfit    = targetPrice − realCostWithFixed          // == realCostWithFixed × effectiveMargin
isCustomMargin  = vehicle.targetMargin != null

referencePrice  = isSold ? salePrice : listedPrice          // ya existe en la función
targetGap       = referencePrice > 0 ? referencePrice − targetPrice : null

targetStatus:
  referencePrice <= 0                 → null       // sin precio de referencia
  referencePrice >= targetPrice       → 'MEETS'    // verde: cumple o supera la meta
  referencePrice >= realCostWithFixed → 'PROFIT'   // amarillo: rentable pero bajo meta
  else                                → 'BELOW'     // rojo: no cubre ni el costo
```

Notas:

- `realCostWithFixed` ya se calcula en la función; el target lo reutiliza.
- Si `realCostWithFixed <= 0` (vehículo sin costo registrado, ej. NEGOCIANDO sin
  compra, o cruce sin `purchasePrice`), `targetPrice` queda en 0 y `targetStatus`
  se resuelve por las reglas anteriores (típicamente `null` si tampoco hay
  precio de referencia). No se fuerza ningún target sobre un costo inexistente.
- `targetProfit` se redondea a COP sin decimales (convención del proyecto).

### `projectProfit`

El simulador hipotético recibe el mismo tratamiento: acepta `targetMarginDefault`
(o un `targetMargin` explícito en `params`) y devuelve `targetPrice` y
`targetProfit` sobre el `totalCost` que ya calcula. Permite simular *"con este
costo y margen, ¿cuál es el precio objetivo?"*.

## Agregado del inventario

Nuevo método en `backend/src/services/dashboardService.js`: `getPipelineTarget()`.

- **Universo:** vehículos en stages **`COMPRADO`, `ALISTAMIENTO`, `PUBLICADO`,
  `DISPONIBLE`**.
  - `NEGOCIANDO` se excluye: aún no hay compra, no hay costo base fiable.
  - `VENDIDO` se excluye: el negocio ya cerró.
- Lee `fixedMonthly` y `targetMarginDefault` desde `Setting` (mismo patrón ya
  usado para `fixedMonthly`).
- Para cada vehículo aplica `calculateVehicleMetrics` y agrega:

```
sumTargetPrice   = Σ targetPrice
sumTargetProfit  = Σ targetProfit
sumRealCost      = Σ realCostWithFixed
sumListed        = Σ listedPrice
pipelineGap      = sumListed − sumTargetPrice   // negativo = el publicado no alcanza la meta
statusCounts     = { MEETS, PROFIT, BELOW, unknown }  // conteo de vehículos por targetStatus
vehicleCount     = número de vehículos considerados
```

## API

No se crean endpoints nuevos para el dato por vehículo; se enriquecen los
existentes.

- `GET /vehicles/:id` y los listados de vehículos → ya devuelven `metrics`;
  ahora incluyen `targetPrice`, `targetProfit`, `effectiveMargin`,
  `isCustomMargin`, `targetGap`, `targetStatus`.
- `PATCH /vehicles/:id` → acepta `targetMargin` (opcional, nullable). Validación
  Joi en `middleware/validation.js`: `Joi.number().min(0).max(1).allow(null).optional()`.
  Enviar `null` limpia el override y vuelve al margen global.
- **Settings** — `targetMarginDefault` se edita por el mismo flujo donde hoy se
  edita `fixedMonthly`. Validación Joi `Joi.number().min(0).max(1).optional()`.
- **Nuevo:** `GET /dashboard/pipeline-target` → retorna el objeto de
  `getPipelineTarget()`. Sigue el patrón Controller → Service existente y el
  envelope de respuesta estándar del proyecto.

Invocar la skill `api-design` al concretar el contrato del endpoint nuevo
(status codes, forma del envelope, errores).

## UI (Español, Colombia)

1. **Detalle de vehículo** — tarjeta "Precio objetivo":
   - Precio objetivo (COP), ganancia objetivo, margen aplicado con badge
     `global` / `personalizado`.
   - Semáforo (verde/amarillo/rojo) según `targetStatus`, comparando contra el
     precio publicado (o de venta si está vendido), con la brecha (`targetGap`).
   - Input para fijar/limpiar el override `targetMargin`.
2. **Lista de vehículos** — badge/columna con el semáforo `targetStatus` para
   escanear el inventario de un vistazo.
3. **Dashboard** — bloque "Meta del pipeline": suma proyectada objetivo vs.
   publicado, `pipelineGap`, y conteo por estado del semáforo.
4. **Configuración** — campo "Margen objetivo (%)" junto al de gasto fijo
   mensual, guardando la key `targetMarginDefault`.

Componentes nuevos en `frontend/src/components/{domain}/` según convención.
Frontend consume `metrics` del vehículo (ya en el estado vía AppContext) sin
duplicar el cálculo — la fuente de verdad del target es el backend.

## Manejo de errores y bordes

- Margen fuera de `[0, 1]` → rechazado por Joi antes de tocar la DB.
- Vehículo sin costo (`realCostWithFixed <= 0`) → `targetPrice = 0`,
  `targetStatus` típicamente `null`; la UI muestra "sin datos suficientes" en vez
  de un semáforo engañoso.
- `targetMarginDefault` ausente en `Setting` → fallback a `DEFAULT_TARGET_MARGIN`.
- Vehículo vendido → el semáforo compara `salePrice` (no `listedPrice`) contra el
  target, midiendo cumplimiento real al cierre.

## Testing (TDD — tests primero)

Invocar la skill `tdd-workflow` antes de escribir código.

### `backend/src/utils/__tests__/financial.test.js`

- Target con margen global (sin override).
- Target con override por vehículo tiene prioridad sobre el global.
- Markup exacto: `targetProfit == realCostWithFixed × effectiveMargin`.
- `targetStatus = 'MEETS'` cuando publicado ≥ target.
- `targetStatus = 'PROFIT'` cuando costo ≤ publicado < target.
- `targetStatus = 'BELOW'` cuando publicado < costo.
- Sin `listedPrice` (y no vendido) → `targetStatus = null`, `targetGap = null`.
- Vehículo vendido usa `salePrice` como precio de referencia del semáforo.
- Margen 0 → `targetPrice == realCostWithFixed`, `targetProfit == 0`.
- `realCostWithFixed <= 0` → `targetPrice = 0`, sin crash.

### `dashboardService`

- `getPipelineTarget` suma solo stages activos (COMPRADO, ALISTAMIENTO,
  PUBLICADO, DISPONIBLE).
- Excluye `VENDIDO` y `NEGOCIANDO`.
- `pipelineGap = sumListed − sumTargetPrice` con signo correcto.
- `statusCounts` cuadra con el número de vehículos.

### E2E (skill `e2e-testing`)

- La tarjeta de precio objetivo aparece en el detalle y refleja el override.
- El bloque de meta del pipeline aparece en el dashboard.

Cobertura objetivo ≥ 80 % en la lógica nueva.

## Verificación

Antes de marcar completo, invocar la skill `verification-loop`
(build + lint + tests + security).

## Orden de implementación sugerido

1. Migración Prisma (`targetMargin` en `Vehicle`) + skill `database-migrations`.
2. Tests de `financial.js` (RED) → lógica de target en `calculateVehicleMetrics`
   y `projectProfit` (GREEN).
3. `getPipelineTarget` en `dashboardService` con sus tests.
4. Validación Joi (`targetMargin`, `targetMarginDefault`) + endpoint
   `GET /dashboard/pipeline-target`.
5. UI: tarjeta de detalle, badge en lista, bloque de dashboard, campo de config.
6. E2E + `verification-loop`.
