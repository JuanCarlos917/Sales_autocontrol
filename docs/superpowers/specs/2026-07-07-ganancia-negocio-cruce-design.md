# Ganancia del Negocio con Cruce (trade-in) — Diseño

Fecha: 2026-07-07 · Estado: aprobado por el usuario · Rama objetivo: `dev`

## Problema

Cuando una venta recibe un vehículo en parte de pago (cruce), el pipeline muestra
dos números que confunden: el origen aparece con ganancia alta (incluye el cruce
valorado como ingreso) y el cruce revendido aparece con pérdida. Económicamente
fue UN solo negocio. Caso real que motivó el diseño: Vitara FJT326 (+4.806.000 en
card) + moto PZD94H (−3.062.500 en card), cuando el negocio completo dejó
2.623.500 directos.

Además, la card muestra un único número `netProfit` que ya descuenta gastos fijos
prorrateados sin indicarlo, y el dashboard no aclara qué incluyen sus KPIs.

## Decisiones del usuario (cerradas)

1. La ganancia del negocio se muestra **solo en el último eslabón** de la cadena
   de cruces al venderse. El origen muestra un mensaje de diferimiento y **nunca**
   vuelve a mostrar número propio mientras la cadena exista.
2. El número mostrado es la **ganancia directa**: Σ por eslabón de
   `salePrice − purchasePrice − gastosDirectos`. **Sin** fijos prorrateados y
   **sin** comisiones en la card (eso queda en el detalle del vehículo).
3. Card limpia: sin desglose de fijos/comisiones en el pipeline.
4. Dashboard: cifras intactas, solo subtítulos aclaratorios.

## Reglas de negocio

**Cadena de negocio** = vehículo + sus `tradeInsReceived`, recursivo (un cruce
que a su vez recibe cruces extiende la misma cadena). Relaciones ya existentes
en el schema (`sourceVehicleId` / `tradeInsReceived`); cero migraciones.

**Ganancia directa del negocio** = Σ de cada eslabón VENDIDO:
`salePrice − purchasePrice − totalExpenses` (gastos no soft-deleted, como en
`calculateVehicleMetrics`). Para el cruce, `purchasePrice` es el valor del cruce
(17.5M en el caso real) — así la sobre/subvaloración del cruce queda neteada
dentro del negocio.

**Render en pipeline (solo stage VENDIDO):**

| Situación | Card muestra |
|---|---|
| Sin cruces | Igual que hoy (`netProfit`) — sin cambios |
| Entregó cruce(s) y algún eslabón sigue vivo | `↪ Ganancia en cruce <placa>` (link al cruce) |
| Es el último eslabón vendido de la cadena | `Ganancia del negocio (<placas>)` + directa |
| Es eslabón intermedio (vendido, cadena cerrada) | `↪ Ganancia en cruce <placa>` (permanente) |

**Casos borde:**
- **Venta cancelada / cruce eliminado**: `VehicleStage` no tiene estado CANCELLED.
  Si se cancela la venta origen (`cancelSale` → vuelve a DISPONIBLE), el origen deja
  de ser VENDIDO y la cadena queda "viva" (sin vitrina). Si el vehículo-cruce se
  elimina, la relación se rompe (`SetNull`) y la cadena se disuelve sola. Follow-up
  conocido: `cancelSale` hoy NO desvincula el cruce ya creado (ver Follow-ups).
- **Multi-cruce** en una venta: la ganancia se muestra en el último eslabón que
  se venda (mayor `saleDate`; empate → mayor `id`). Los demás difieren.
- **Participación**: v1 muestra el negocio al 100%. El reparto por socio sigue
  por vehículo en el detalle. Fuera de alcance: ponderar `myProfit` por cadena.
- Cadena rota (`sourceVehicleId` en null por borrado del origen): el cruce se
  trata como vehículo sin cadena.

## Backend

- `backend/src/utils/financial.js` — nuevo helper puro:
  `calculateDealMetrics(chain)` → `{ directProfit, chainPlates, closed, showcaseVehicleId }`.
  `chain` = lista de vehículos (con expenses) de la cadena. Sin I/O: testeable
  con unit tests puros, siguiendo el patrón del archivo.
- `vehicleService` (listado del kanban y detalle): carga las relaciones de cruce
  y anexa a las metrics existentes:
  - `deal: { directProfit, chainPlates }` — solo en el eslabón vitrina de una
    cadena cerrada.
  - `profitDeferredTo: { id, plate }` — en los demás eslabones VENDIDO de la
    cadena (viva o cerrada).
  Vehículos sin cruces: ninguno de los dos campos (el frontend no cambia nada).
- `dashboardService`: **intacto** (la suma por vehículo es invariante al agrupar
  por negocio).
- Recursión acotada: la cadena se resuelve con las relaciones ya cargadas
  (profundidad práctica 1-2; cap defensivo de profundidad 10).

## Frontend

- **KanbanPage** (card VENDIDO): tres ramas — `profitDeferredTo` →
  `↪ Ganancia en cruce <placa>` (link, `stopPropagation` para no abrir el detalle
  del vehículo actual); `deal` → label "Ganancia del negocio (<placas>)" + número
  con color verde/rojo actual; ninguno → render actual sin tocar.
- **DashboardPage**: subtítulo en los KPIs: "Ganancia Neta — después de fijos y
  comisiones" y "Mi Ganancia Total — según participación". Sin cambios de datos.
- **VehicleDetailPage**: en el bloque de cruce existente (ambos sentidos), línea
  adicional: "Ganancia del negocio completo: $X" cuando la cadena esté cerrada.
  En el detalle sí se muestra en todos los eslabones (el detalle es para
  profundizar; la regla de "una sola vez" aplica al pipeline).

## Paso operativo (producción, sin código — separado de esta feature)

Re-registrar la comisión pagada de 1.750.000 del negocio FJT326+PZD94H:
1. Reversar el gasto `OPERATING_EXPENSE` suelto (`cmqwzavt6003ys61qav35wzcs`)
   con el reverso universal (ADMIN + motivo).
2. Registrarla como comisión de la venta de la Vitara vía módulo de comisiones
   (Payable COMMISSION pagado). **Dato pendiente: tercero receptor.**
3. El restante de la comisión vive únicamente en el crédito futuro del usuario
   (flujo de conciliación existente) — sin doble descuento.

Nota: no cambia el número del pipeline (que usa la directa); mejora detalle y
reportes.

## Testing

- **Unit (node --test), `financial.test.js`:** `calculateDealMetrics` —
  sin cruces; cadena viva (difiere); cadena cerrada de 2; cadena de 3;
  multi-cruce (vitrina = último vendido); cadena rota.
  Pendiente: cadena rota (relación SetNull) y sibling-deferral en multi-cruce.
- **E2E (Playwright):** flujo venta con cruce → card origen muestra "↪ en cruce";
  vender el cruce → card del cruce muestra "Ganancia del negocio" con la directa
  y el origen mantiene el diferimiento. Reusar helpers de `tests/helpers/api.ts`.
- Suite completa antes de merge (lección de proceso registrada del feature de
  reversos).

## Fuera de alcance

- Ponderación de `myProfit`/participación a nivel de negocio.
- Cambios al dashboard más allá de subtítulos.
- Vista de "negocios" agrupados como entidad propia.

## Follow-ups (revisión final de rama, 2026-07-07)

- **`cancelSale` no desvincula el cruce creado** (`saleService.js` ~583): tras cancelar
  la venta origen, el cruce conserva `sourceVehicleId`; si el origen se revende y el
  cruce fantasma se vende, la cadena renace con un `purchasePrice` de una venta
  anulada → cifra errónea en pipeline. Requiere decisión de negocio (desvincular o
  bloquear cancelSale con cruce vivo).
- **Scope `userId` en `loadDealChainNodes`** (`vehicleService.js` ~136): el `findMany`
  de eslabones faltantes no filtra por usuario; hoy las cadenas son mono-usuario por
  construcción, pero conviene defensa en profundidad.
- **Doble render de "Ganancia del negocio completo"** en el detalle para una vitrina
  intermedia de cadena ≥3 (dos bloques de cruce simultáneos). Cosmético.
- **Unit tests pendientes**: cadena rota (SetNull) y sibling-deferral en multi-cruce;
  el motor `enrichWithDealMetrics` no tiene unit test directo (cubierto solo por e2e).
- Menores heredados de las tareas: `aria-hidden` en el glyph ↪ de la card; `??` vs `||`
  en defaults numéricos; guard `newVehicle!` en helpers e2e.
