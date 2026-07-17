# Diseño — Socio (partner) en la cascada de venta

**Fecha:** 2026-07-17
**Estado:** Aprobado (diseño) — pendiente plan de implementación
**Autor:** Juan Carlos + Claude
**Relacionado:** [[2026-07-15-ganancia-inversionistas-comisiones-design]]

## 1. Problema

La cascada nueva (`calculateSaleDistribution`) **ignora la participación del socio**: reparte
toda la ganancia entre el fondo de inversionistas y calcula reservas (reinversión/impuestos)
sobre el total. Cuando un carro tiene un **socio** (co-inversor externo de ESE carro), eso es
incorrecto:

- Las reservas se cobran también sobre la parte del socio (no tiene sentido: el socio no
  reinvierte ni paga impuestos del negocio).
- La comisión no distingue quién la financia.
- La parte de la ganancia del socio se reparte al fondo, cuando es suya.

## 2. Modelo de negocio (confirmado)

### Detección
- El **socio** y su aporte se capturan en la **compra** (`Vehicle.partnerId`,
  `partnerContribution`; `participation` = parte del fondo, derivada automáticamente de los
  aportes vía `calculateParticipation`). La venta los **lee**; no se captura socio nuevo al vender.
- `socioShare = 1 − participation` (parte del socio). `fundShare = participation` (parte tuya/fondo).
- **Externo vs inversionista:** el socio es *inversionista* si su `partnerId` está en el
  `investor_team` (o es `owner-self`); si no, es *externo*.

### Reglas (validación en la compra)
- **Socio inversionista ⟺ 100%.** Un inversionista solo puede ser socio poniendo el 100% del
  carro (`partnerContribution == purchasePrice`, `participation == 0`). Sirve para "el 100% de la
  ganancia de este carro es de esta persona".
- **Socio externo ⟺ parcial.** Un externo siempre pone una parte (`participation > 0`); no puede
  ser 100%.
- Sin socio → comportamiento actual (fondo dueño del 100%).

### Principio de las reservas
> Las reservas (reinversión/impuestos) aplican **solo sobre la parte del fondo/inversionistas**.
> La parte de un **socio externo está exenta**. Si el socio es **inversionista** (caso 100%), su
> parte SÍ es dinero del fondo → las reservas aplican sobre todo.

### Principio de la comisión (opción 3b)
> La comisión se calcula sobre la ganancia **bruta** (`commission_gross_pct %`) y se reparte
> **por el % invertido**. El socio recibe su ganancia **completa** y queda **debiendo su parte de
> la comisión como una Cuenta por Cobrar (RECEIVABLE)** que se le cobra aparte. La parte del fondo
> se financia inline (deducida de la ganancia del fondo antes de repartir).

### Cascada — casos (números de ejemplo: bruta $10M, comisión 10% = $1M)

**Caso A — socio externo 40% (fondo 60%):**
```
Ganancia socio (PARTNER_SHARE)   = 40% × 10M = 4.0M   (sin reservas)
CxC comisión socio (RECEIVABLE)  = 40% × 1M  = 0.4M   → socio neto 3.6M
Fondo after-comisión             = 60% × (10M − 1M) = 5.4M
  − reinversión 30% × 5.4M       = 1.62M
  − impuestos   10% × 5.4M       = 0.54M
Reparto al fondo (PROFIT_SHARE)  = 3.24M  → inversionistas por capital
```
Cuadre: 3.6M (socio) + 3.24M (fondo) + 2.16M (reservas) + 1M (vendedores) = 10M ✅

**Caso B — socio inversionista al 100%:**
```
Ganancia socio (PARTNER_SHARE)   = 10M − reservas(3.6M) = 6.4M
CxC comisión socio (RECEIVABLE)  = 100% × 1M = 1.0M     → socio neto 5.4M
Reservas (aplican, es del fondo) = reinversión 2.7M + impuestos 0.9M = 3.6M
Reparto al resto del fondo       = 0  (todo es del socio-inversionista)
```
Cuadre: 5.4M (socio neto) + 3.6M (reservas) + 1M (vendedores) = 10M ✅

## 3. Objetos de tesorería (lo nuevo)

Por venta con socio, además de lo actual:
- **`PARTNER_SHARE`** (nuevo `PayableType`): CxP a nombre del socio por su ganancia.
  - Externo: `socioShare × grossProfit` (sin reservas).
  - Inversionista 100%: `grossProfit − reservas`.
- **Comisión del socio** → **`RECEIVABLE`** (tipo existente) a nombre del socio por
  `socioShare × commissionPool`. Aparece en Cuentas por Cobrar; se cobra aparte (3b).
- **Reservas** (transfers a `budget-reinvest`/`budget-tax`): base = parte del fondo (externo) o
  todo (inversionista 100%), proporcional al efectivo recibido (igual que hoy).
- **Reparto al fondo** (`PROFIT_SHARE` a inversionistas): solo la parte del fondo, después de
  reservas. En el caso 100% es 0.

`PARTNER_SHARE` se elige (en vez de reutilizar `PROFIT_SHARE`) para que la página de
Inversionistas siga siendo **solo del fondo** y el socio no se confunda con los inversionistas.

## 4. Cálculo — `calculateSaleDistribution`

Extender la función pura para recibir el contexto del socio:

```
calculateSaleDistribution(vehicle, cfg, { sellers, investors, socio }) → {
  ...campos actuales,
  socioShare,              // 1 − participation (0 si no hay socio)
  socioIsInvestor,         // bool
  partnerProfit,           // ganancia del socio (PARTNER_SHARE); 0 si no hay socio
  partnerCommissionOwed,   // socioShare × commissionPool (RECEIVABLE); 0 si no hay socio
  // reinvestAmount/taxAmount/profitToDistribute ahora sobre la parte del fondo
}
```

- `socio` = `{ thirdPartyId, share, isInvestor }` derivado de `vehicle.partnerId` / `participation`
  y de si `partnerId ∈ investor_team ∪ {owner-self}`.
- `investorRows` (reparto del fondo) se calcula sobre `profitToDistribute` de la parte del fondo.
- Sin socio (`socioShare == 0`): idéntico al comportamiento actual (regresión cero).
- Redondeo COP con `roundCop`; cada bloque cuadra exacto (mismo patrón `split`).

## 5. Flujo de venta — `saleService.registerSale`

Dentro de la `$transaction`, cuando hay socio:
1. Crear `PARTNER_SHARE` (socio, `partnerProfit`).
2. Crear `RECEIVABLE` (socio, `partnerCommissionOwed`, descripción "Comisión socio venta {plate}").
3. Reservas y `PROFIT_SHARE` del fondo sobre la parte del fondo (como en la cascada).
4. `COMMISSION` a vendedores igual que hoy (pool completo; lo financian fondo inline + socio CxC).
- **Reverso/cancelación:** el guard de `cancelSale` debe incluir también `PARTNER_SHARE` (además de
  COMMISSION/PROFIT_SHARE) para no dejar CxP/CxC huérfanas.

## 6. UI

- **Card "el socio [nombre] debe pagar $X":** al ver/pagar la comisión de una venta con socio,
  mostrar la parte de comisión que el socio debe (la `RECEIVABLE`), con su nombre y monto.
- **Ganancia del socio:** se ve en el detalle del vehículo / resumen de venta, etiquetada como
  **"Socio"** (no "Inversionista"). La página de **Inversionistas no cambia** (sigue mostrando solo
  `PROFIT_SHARE` del fondo).
- **Compra (`VehicleFormModal`):** validar en vivo la regla inversionista⟺100% / externo⟺parcial
  al elegir socio + aporte, con mensaje claro.

## 7. Fuera de alcance (YAGNI)

- Devolución del **capital** del socio al vender (no modelada hoy; se maneja aparte). Este spec
  cubre solo ganancia + comisión + reservas del socio.
- Socio inversionista **parcial** (solo se permite 100% para inversionista).
- Múltiples socios por carro (un socio por carro, como hoy).

## 8. Tests

- **Unit (`calculateSaleDistribution`):** caso A (externo parcial), caso B (inversionista 100%),
  sin socio (regresión), cuadre de dinero (Σ partes = bruta), reservas solo sobre parte del fondo,
  comisión por %.
- **Unit validación compra:** inversionista con <100% → error; externo con 100% → error.
- **Integración (`registerSale`):** con socio externo crea `PARTNER_SHARE` + `RECEIVABLE` +
  `PROFIT_SHARE` del fondo + reservas correctas; caso 100% reparto al resto del fondo = 0.
- **Reverso:** cancelar venta con socio bloquea/anula `PARTNER_SHARE` y la `RECEIVABLE`.
- **E2E:** venta con socio → card "socio debe pagar X" + CxC en cobrar; ganancia del socio
  etiquetada; Inversionistas sin el socio.

## 9. Riesgos

- Toca `calculateSaleDistribution` y `registerSale` (flujo financiero en producción). Mitigación:
  TDD, función pura testeada antes de tocar el service, casos de cuadre de dinero.
- Nuevo `PayableType` requiere migración `ADD VALUE` idempotente (como `PROFIT_SHARE`).
- La detección externo/inversionista depende del `investor_team`: si cambia después de la venta,
  la CxP ya está persistida (inmune); la detección se hace **al vender**.
