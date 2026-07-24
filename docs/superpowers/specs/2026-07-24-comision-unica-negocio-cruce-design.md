# Comisión única por negocio con cruce (diferimiento de distribución al cierre)

**Fecha:** 2026-07-24
**Estado:** Aprobado (diseño)
**Rama:** por crear desde `main`

## Problema

Hoy `calculateSaleDistribution` corre por cada venta individual. En un negocio con cruce
(carro A se vende recibiendo carro B como parte de pago), esto genera DOS distribuciones:

1. Venta de A → comisión sobre ganancia de A (+ COMMISSION_RETURN si hay socio
   inversionista 100%, + reservas, + ganancia).
2. Venta de B (el recibido) → otra comisión sobre ganancia de B, otras reservas, etc.

El negocio real es UNO solo (ya reflejado en el pipeline con la "vitrina" de
`calculateDealMetrics`): la ganancia solo se conoce al cerrar la cadena, y debe existir
**una sola comisión** calculada sobre la ganancia total del negocio, pagada al vendedor
solo si el negocio deja ganancia.

## Decisiones de diseño (validadas con el usuario)

| # | Decisión | Elección |
|---|----------|----------|
| 1 | Comisión en la primera venta (con cruce) | **Ninguna** — no se crea CxP COMMISSION ni COMMISSION_RETURN |
| 2 | Alcance de la regla | **Cualquier venta con cruce** (con o sin socio 100%) |
| 3 | Resto de la cascada en la primera venta | **Todo se difiere** (ni reservas, ni PROFIT_SHARE, ni PARTNER_SHARE) |
| 4 | Cruce parcial (dinero + carro) | Igual: **toda** la distribución se difiere |
| 5 | Base de la comisión única al cierre | **Ganancia directa del negocio completo** (Σ eslabones, misma fórmula de la vitrina) |
| 6 | Socio 100%: liquidación de capital | **Efectivo ya, resto al cierre** — al vender A recibe CAPITAL_RETURN por la parte en efectivo cobrada (tope: su capital); el remanente + su ganancia al cierre |
| 7 | Segunda venta (cierre) | Flujo normal del fondo con la base del negocio; si no hay ganancia, no hay comisión (`skip`) |
| 8 | Socio externo parcial + cruce | **Mantiene flujo actual** (distribución inmediata por venta); el diferimiento aplica solo sin socio o con socio inversionista 100% |

## Comportamiento nuevo

### Primera venta (venta con cruce: `tradeIn.value > 0`)

En `saleService.registerSale`, cuando la venta recibe un vehículo en parte de pago
**y** el vehículo vendido no tiene socio externo parcial:

- **NO** se ejecuta la distribución (Paso 5 actual completo): sin CxP COMMISSION,
  COMMISSION_RETURN, PROFIT_SHARE, PARTNER_SHARE, sin transfers de reservas.
- Todo lo demás de la venta queda igual: transacciones de cobro, CxC del saldo,
  creación del vehículo cruce (`fromTradeIn`, `sourceVehicleId`, `negotiatedValue`).
- **Excepción socio inversionista 100%:** se crea una CxP `CAPITAL_RETURN` parcial por
  `min(efectivo cobrado en la venta, partnerContribution)`. Si es 0 (venta 100% cruce),
  no se crea nada.
- `summary.distribution` devuelve un marcador `{ deferred: true, reason: 'trade_in' }`
  para que la UI muestre "Distribución diferida al cierre del negocio".

### Venta de cierre (vehículo `fromTradeIn: true` vendido SIN nuevo cruce)

1. **Cargar la cadena** siguiendo `sourceVehicleId` hacia atrás (reutilizar/extraer la
   lógica de `loadDealChainNodes` de `vehicleService` a un helper compartido).
2. **Eslabones elegibles** = miembros de la cadena en `VENDIDO` (incluido el que se está
   vendiendo) que **no tengan distribución previa** (sin CxP `COMMISSION`,
   `PROFIT_SHARE`, `PARTNER_SHARE` ni `COMMISSION_RETURN` con su `vehicleId`).
   `CAPITAL_RETURN` **no** cuenta como distribución (puede existir el parcial del socio).
3. **Base del negocio:** `chainGrossProfit = Σ (venta − costo − gastos no borrados)` de
   los eslabones elegibles, donde costo = `negotiatedValue` si `fromTradeIn`, si no
   `purchasePrice` (idéntico a `calculateDealMetrics`).
4. **Cascada:** `calculateSaleDistribution` se ejecuta UNA vez con esa base
   (se le pasa la ganancia de cadena en lugar de la del vehículo — ver Implementación).
   - `sellers` = participantes de ESTA venta (o equipo default), como hoy.
   - `investors` = equipo de inversionistas actual, como hoy.
   - `socio` = socio inversionista 100% del **eslabón más antiguo de la cadena elegible
     que tenga `partnerId`** (normalmente el origen A). El vehículo de cierre no tiene
     `partnerId`, por eso se resuelve desde la cadena. Si ningún eslabón tiene socio →
     cascada sin socio (fondo normal).
5. **Artefactos** (todos anclados al `vehicleId` del vehículo de cierre / vitrina):
   - Sin socio: CxP `COMMISSION` por vendedor + transfers de reservas (× `cashRatio` de
     ESTA venta) + CxP `PROFIT_SHARE` por inversionista. Igual que hoy, con base de cadena.
   - Socio inversionista 100%: CxP `COMMISSION_RETURN` (pool → cuenta del socio; él paga
     vendedores, flujo FASE B existente) + CxP `COMMISSION` por vendedor + reservas +
     CxP `PARTNER_SHARE` = `afterCommission − reservas` + CxP `CAPITAL_RETURN` por el
     remanente: `partnerContribution − Σ CAPITAL_RETURN ya creados en la cadena`.
6. **Sin ganancia:** si `chainGrossProfit ≤ 0` o sin base de costo → `skip` actual:
   no se crea nada de comisión/ganancia. Con socio 100%, el remanente de
   `CAPITAL_RETURN` **sí** se crea igual (el capital no depende de la ganancia).

### Ejemplo de referencia

A comprado en 40M (socio 100%), vendido en 50M = 30M efectivo + B (20M).
B vendido después en 25M con 1M de gastos.

- Venta de A: CxP CAPITAL_RETURN 30M al socio. Nada más.
- Venta de B (cierre): ganancia negocio = (50−40−0) + (25−20−1) = **14M**.
  - `commissionPool = commission_gross_pct% × 14M` → COMMISSION_RETURN al socio +
    COMMISSION a vendedores.
  - Reservas sobre `14M − pool`; `PARTNER_SHARE = 14M − pool − reservas`.
  - `CAPITAL_RETURN` remanente = 40M − 30M = **10M**.

## Compatibilidad con datos existentes

Sin migración. La regla de "eslabones elegibles" (paso 2) excluye automáticamente
ventas pre-feature que ya distribuyeron: si A vendió con el flujo viejo (ya tiene CxP
COMMISSION), el cierre en B usa solo la ganancia de B. El caso socio externo parcial
(decisión 8) también queda cubierto por esta misma regla: su venta distribuye inmediato
y el cierre lo excluye.

## Casos borde

- **Cadena A→B→C:** la venta de B también recibe cruce → se difiere otra vez; el cierre
  en C agrega los 3 eslabones elegibles. Recursión natural, sin lógica extra.
- **cancelSale:** sin cambios de código. La venta diferida de A puede tener
  CAPITAL_RETURN parcial → el guard existente bloquea la cancelación (conservador,
  correcto). El cierre en B tiene todos los artefactos anclados a B → guard existente
  aplica. Sigue vigente el follow-up preexistente: `cancelSale` no desvincula el cruce.
- **Venta de cierre 100% financiada (`cashReceived = 0`):** CxPs se crean completas,
  reservas no mueven efectivo (cashRatio 0) — igual que hoy.
- **`negotiatedValue` ausente en un eslabón:** ese eslabón aporta costo 0 → la regla
  actual de `purchaseCost <= 0` no aplica por-eslabón sino al total; si la cadena no
  tiene base de costo (todos en 0), `skip`.

## Reporting / UI

- **Página de comisiones (`commissionService.listByVehicle`):** el item del vehículo de
  cierre debe mostrar la cascada del NEGOCIO (base = ganancia de cadena, con las placas
  de los eslabones), no solo su venta. Los eslabones diferidos no aparecen como items
  propios (no tienen CxP).
- **Página de inversionistas (`investorService.listByVehicle`):** misma consideración
  para el item de cierre (base de cadena).
- **Resumen post-venta (wizard):** cuando `deferred: true`, mostrar "Distribución
  diferida al cierre del negocio (cruce <placa recibida>)".
- **Pipeline/vitrina:** sin cambios (ya muestra la ganancia una sola vez).

## Implementación (unidades)

1. **`financial.js`:** `calculateSaleDistribution` acepta una base externa opcional
   (`overrideGrossProfit` o un nuevo helper `calculateChainGrossProfit(members)`) sin
   romper la firma actual. La identidad venta−costo−gastos por vehículo se mantiene
   para ventas sin cruce.
2. **`commissionService`:** nuevo `resolveChainSocio(prismaOrTx, chainMembers, cfg)`
   (reutiliza `resolveSocio` sobre el eslabón con `partnerId`). Helper
   `findEligibleChainMembers` (sin distribución previa).
3. **`saleService.registerSale`:** rama de diferimiento (cruce presente) y rama de
   cierre (fromTradeIn sin cruce) alrededor del Paso 5 actual. Venta normal sin cruce y
   sin `fromTradeIn`: código actual intacto.
4. **Chain loader compartido:** extraer el walk de `sourceVehicleId` de
   `vehicleService.loadDealChainNodes` a un helper reutilizable (o exportarlo).
5. **UI:** ajustes de la página de comisiones/inversionistas + mensaje del wizard.

## Testing

- **Unit (`financial`):** cascada con base de cadena (ejemplo 14M), cadena sin ganancia,
  cadena con eslabón sin costo.
- **Unit (`saleService`):** venta con cruce no crea distribución (con y sin socio 100%);
  CAPITAL_RETURN parcial = min(efectivo, capital); cierre crea artefactos con base de
  cadena; cierre excluye eslabones con distribución previa (compat); socio externo
  parcial mantiene flujo actual.
- **E2E (Playwright):** negocio completo socio 100% + cruce: vender A (verificar que NO
  aparece comisión), vender B, verificar comisión única sobre 14M, COMMISSION_RETURN,
  CAPITAL_RETURN remanente y widget "Comisión por pagar".
