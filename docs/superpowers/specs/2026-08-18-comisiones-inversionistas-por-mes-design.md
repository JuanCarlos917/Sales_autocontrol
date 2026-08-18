# Comisiones e Inversionistas — organización por mes

Fecha: 2026-08-18

## Problema

`CommissionsPage.jsx` e `InvestorsPage.jsx` (páginas espejo) muestran las
comisiones/ganancias como un grid plano de cards por vehículo: pendientes arriba
y una sección "Pagadas" colapsada, sin ningún orden cronológico. Con el histórico
creciendo, no hay forma de leer "qué se movió cada mes".

## Objetivo

Agrupar ambas secciones (pendientes y pagadas) por **mes de la fecha de venta**,
con encabezado de mes que muestre el **count de negocios** y el **subtotal (total)**
del mes.

## Decisiones (acordadas con el usuario)

- **Fecha base:** mes de `vehicle.saleDate`. Las fechas de pago siguen visibles
  dentro de cada card (ya se renderizan hoy por rol); no cambian.
- **Granularidad:** agrupado por mes con subtotal.
- **Alcance:** aplica a las dos secciones — pendientes y pagadas.
- **Subtotal:** por **total** del mes = suma de `roles.total` de los ítems del
  grupo, **excluyendo** roles con estado `CANCELLED`.
- **Count:** número de negocios (vehículos/cards) del grupo.
- **Sin cambios de backend:** todo se deriva de datos que las páginas ya reciben.

## Comportamiento

- Meses en orden **descendente** (más reciente primero).
- Dentro de cada mes, cards ordenadas por `saleDate` descendente.
- Encabezado del grupo: `Agosto 2026 · 3 negocios` a la izquierda; `$X total` a la
  derecha (mono). Total en color neutro emfatizado (no ámbar/verde, porque
  representa el total del mes, no lo pendiente ni lo pagado).
- Ítems sin `saleDate` → bucket `Sin fecha` al final (defensivo; no debería ocurrir
  porque comisiones/ganancias solo existen tras la venta).
- Mes con 1 negocio → `1 negocio` (singular).

## Arquitectura

### 1. Helper puro — `frontend/src/lib/monthGrouping.js`

```
groupByMonth(items, { dateOf, sumOf }) -> [
  { monthKey: '2026-08', monthLabel: 'Agosto 2026', count, subtotal, items: [...] }
]
```

- `dateOf(item)` → devuelve la fecha a agrupar (aquí `item.vehicle.saleDate`).
- `sumOf(item)` → devuelve el total del ítem para el subtotal (suma de
  `roles.total` no canceladas).
- Ordena grupos por `monthKey` descendente; `Sin fecha` (key nula) siempre al final.
- Ordena `items` dentro del grupo por fecha descendente.
- `monthLabel` con `toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })`
  capitalizando la primera letra.
- Función pura, sin dependencias de React. Testeable de forma aislada.

### 2. Componente compartido — `frontend/src/components/treasury/MonthGroupedGrid.jsx`

Props: `{ items, renderCard, sumOf, dateOf }`.

- Usa `groupByMonth` y renderiza, por cada grupo:
  - Encabezado `<div>` con `monthLabel · N negocio(s)` + `formatCurrency(subtotal) total`.
  - El grid existente `grid grid-cols-1 lg:grid-cols-2 gap-4` con `items.map(renderCard)`.
- `data-testid="month-group-<monthKey>"` en cada grupo y
  `data-testid="month-group-subtotal-<monthKey>"` en el subtotal para e2e.

### 3. Integración en las páginas

En `CommissionsPage.jsx` e `InvestorsPage.jsx`:

- Reemplazar el grid de **pendientes** y el grid de **pagadas** por
  `<MonthGroupedGrid items={pending|paid} renderCard={...} dateOf sumOf />`.
- `dateOf = (i) => i.vehicle.saleDate`.
- `sumOf = (i) => i.roles.filter(r => r.status !== 'CANCELLED').reduce((s,r) => s + r.total, 0)`.
- KPIs, sección "Por persona", botón de colapsar "Pagadas" y el `PaymentModal` no
  cambian.

## Testing

- **Unit** (`monthGrouping.test.js`): agrupa por mes, ordena meses desc, ordena
  ítems desc dentro del mes, subtotal excluye canceladas, count correcto, bucket
  `Sin fecha` al final, lista vacía → `[]`.
- **E2E**: revisar `tests/e2e/sales/commissions.spec.ts` (no hay spec de
  inversionistas por ahora) y actualizarlo si asume el grid plano; verificar que
  aparecen encabezados de mes y subtotales.

## Fuera de alcance

- Filtros por rango de fechas.
- Cambios de backend / nuevos endpoints.
- Reordenar o agrupar la sección "Por persona".
