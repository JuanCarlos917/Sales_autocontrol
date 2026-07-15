# Diseño — Separar Ganancia (inversionistas) y Comisión (vendedores)

**Fecha:** 2026-07-15
**Estado:** Aprobado (diseño) — pendiente plan de implementación
**Autor:** Juan Carlos + Claude

## 1. Problema

Hoy el sistema mezcla dos conceptos distintos bajo el flujo de "comisiones":

- Calcula una *base de comisión* (`grossProfit × participation`) y la reparte **60/30/10**
  (comisión a participantes / reinversión / impuestos).
- El **resto** de la comisión va a `owner-self` (el dueño), tratándolo como un comisionista más.
- Los **inversionistas** casi no se modelan: solo existe un `partner` por carro cuya "ganancia"
  se *calcula y muestra*, pero **no se registra como CxP ni se le rinde cuentas**.

Resultado: las **comisiones** tienen trazabilidad real (CxP por persona, pagos, auditoría),
pero los **rendimientos a inversionistas** no. No hay forma de rendir cuentas a los inversionistas.

## 2. Modelo de negocio (confirmado)

- **Fondo común fijo rotatorio.** 3 inversionistas con % de capital estables. La plata rota
  entre carros; el reparto de ganancia es el mismo % por persona en todos los carros.
- **Inversionistas:** Tú (`owner-self`), mamá, papá. Capital **50 / 25 / 25** (editable).
- **Vendedores (comisionistas):** tu hermano y ocasionalmente otros; puede repartirse entre varios.
- **Rendimiento del inversionista** = reparto de la **ganancia neta** por su % de capital
  (utilidad real, no interés fijo).
- **Comisión del vendedor** = **10%** de la ganancia bruta (editable), repartible entre vendedores.
- **Ambos rubros se pagan por carro** desde caja, con estado de cuenta y auditoría por persona.

### Cascada por venta

```
Venta
− Costos (compra + gastos directos)
= Ganancia bruta (grossProfit)
− Comisión vendedores   = commission_gross_pct % × grossProfit
= afterCommission
− Reinversión           = reinvest_pct % × afterCommission     (reserva → cuenta budget-reinvest)
− Impuestos             = tax_pct %      × afterCommission     (reserva → cuenta budget-tax)
= Ganancia a repartir (profitToDistribute)
→ Reparto entre inversionistas por % de capital
```

Ejemplo (venta 20M, costos 15M, comisión 10%, reservas 30/10, capital 50/25/25):

```
Venta                 20.000.000
− Costos              15.000.000
= Ganancia bruta       5.000.000
− Comisión (10%)         500.000   → vendedores
− Reinversión (30%)    1.350.000   → reserva
− Impuestos (10%)        450.000   → reserva
= A repartir           2.700.000
   Tú 50%    1.350.000
   Mamá 25%    675.000
   Papá 25%    675.000
```

- Las reservas se calculan sobre **afterCommission** (ganancia bruta − comisión).
- Si `grossProfit ≤ 0` → **skip**: no se crea comisión, ni reservas, ni ganancia.
- Como reinversión + impuestos = 40% de `afterCommission`, `profitToDistribute` nunca es negativo
  cuando `grossProfit > 0`.

## 3. Enfoque

**Extender la infraestructura de comisiones simétricamente** (bajo riesgo, reutiliza lo probado).
No hay tablas nuevas: `SaleParticipant` y `Payable` sirven para ambos rubros; solo cambia el
rol y el tipo de CxP.

## 4. Cambios de esquema

```prisma
enum PayableType {
  RECEIVABLE
  PAYABLE
  COMMISSION
  PROFIT_SHARE   // NUEVO — rendimiento a inversionista
}

enum ParticipantRole {
  CAPTADOR       // vendedor
  CERRADOR       // vendedor
  OTHER          // vendedor
  INVESTOR       // NUEVO — inversionista
}
```

- **`SaleParticipant`** se reutiliza tal cual: una fila por inversionista con `role=INVESTOR`,
  `sharePct` = % de capital, `amount` = ganancia asignada, `payableId` → CxP `PROFIT_SHARE`.
- **`Payable`** se reutiliza: CxP `PROFIT_SHARE` `PENDING`, se paga vía `PayablePayment`
  (mismo flujo que `COMMISSION`).
- Los campos legacy `Vehicle.participation / partnerId / partnerContribution / partnerAssumesExpenses`
  **quedan sin uso en este flujo** (fondo común → no hay socio por carro). No se borran.

## 5. Cálculo — `financial.js`

Función pura nueva, fuente única de verdad:

```
calculateSaleDistribution(vehicle, cfg, { sellers, investors }) → {
  grossProfit,
  skip,                    // true si grossProfit <= 0
  commissionPool,          // sin vendedores → 0; con vendedores → round(commission_gross_pct% × grossProfit)
  reinvestAmount,          // round(reinvest_pct% × afterCommission)
  taxAmount,               // round(tax_pct% × afterCommission)
  profitToDistribute,      // afterCommission − reinvest − tax
  sellerRows:   [{ thirdPartyId, role, sharePct, amount }],   // amount = pool × share
  investorRows: [{ thirdPartyId, role: 'INVESTOR', sharePct, amount }],
}
```

- Redondeo COP con `roundCop`. El sobrante por redondeo se asigna a `owner-self` en el bloque de
  inversionistas y al **primer** vendedor en el bloque de comisión, para que cada bloque sume exacto.
- Reemplaza a `calculateCommissionBase` en el flujo de venta (se conserva `calculateCommissionBase`
  solo si algún consumidor legacy lo usa; auditar y migrar).

## 6. Resolución de participantes — `commissionService.js`

**Vendedores (`resolveSellers`, evolución de `resolveParticipants`):**
- Origen: `saleData.participants` (edición por venta) o `commission_default_team` (Settings).
- Reglas: máx 5, sin duplicados, `sharePct > 0`, terceros existentes.
- **Cambio:** los % de vendedores deben **sumar exactamente 100** (reparten el pool completo).
  Un solo vendedor → 100%. **Se elimina el resto a `owner-self`** (el dueño ya no comisiona).
- **Venta sin vendedor** (la vendió el dueño directo): no es error — `commissionPool = 0`, no se crea
  ninguna CxP `COMMISSION`, y `afterCommission = grossProfit` (toda la ganancia fluye a reservas +
  inversionistas). El % de comisión solo se carva si hay al menos un vendedor.

**Inversionistas (`resolveInvestors`, nuevo):**
- Origen: setting `investor_team` (JSON `[{thirdPartyId, sharePct}]`). **No** editable por venta.
- Reglas: suma 100 (tolerancia de redondeo), terceros existentes, `sharePct > 0`.
- **Fallback seguro:** si `investor_team` no está configurado o es inválido → `owner-self` 100%.
  Una venta nunca se rompe por config incompleta (misma filosofía que el fix del centinela).
- Verifica que cada `thirdPartyId` exista (incluido `owner-self`) antes de crear la CxP, para no
  repetir el FK 500 que ya arreglamos (`ensureOwnerExists`).

## 7. Flujo de venta — `saleService.registerSale` (paso 5 reescrito)

Dentro de la misma `$transaction` atómica:

1. `calculateSaleDistribution(...)`.
2. Si `skip` → no crea comisión, reservas ni ganancia.
3. Por cada vendedor: CxP `COMMISSION` + `SaleParticipant(role vendedor)`.
4. Por cada inversionista: CxP `PROFIT_SHARE` + `SaleParticipant(role INVESTOR)`.
5. Transfers de reserva a `budget-reinvest` / `budget-tax`, **proporcionales al efectivo recibido**
   (se conserva la lógica `cashRatio` actual).
6. Ambas CxP nacen `PENDING`; se pagan desde caja por su página con el flujo `PayablePayment`.

**Reverso:** el cancel/reverso de una venta debe anular también las CxP `PROFIT_SHARE`
(hoy ya maneja `COMMISSION`). Se extiende el mismo camino.

## 8. Configuración (Settings) — todo editable, nada hardcodeado

Keys nuevos (seed idempotente con defaults):

| Key | Default | Significado |
|---|---|---|
| `commission_gross_pct` | `10` | Comisión vendedores = % de la ganancia bruta |
| `reinvest_pct`         | `30` | Reserva reinversión = % de afterCommission |
| `tax_pct`              | `10` | Reserva impuestos = % de afterCommission |
| `investor_team`        | `[]` | JSON de inversionistas y su % de capital |

- Se deja de usar `commission_share_pct` (60), `default_captador_pct`, `default_cerrador_pct`
  (modelo 60/30/10 viejo). Se mantienen `reinvest_account_id`, `tax_reserve_account_id`.
- **Settings UI "Equipo de inversionistas":** elegir terceros (Tú=`owner-self`, mamá, papá) y su %;
  valida suma 100. Espejo del equipo de reparto de vendedores.
- mamá y papá se crean una vez como **terceros** y se referencian en el equipo.

## 9. Rendición de cuentas — servicios, API y UI

- **Agregación compartida:** `buildPersonSummary` / `getSummary` / `listByVehicle` se generalizan
  para recibir el `PayableType` (COMMISSION o PROFIT_SHARE), evitando duplicar lógica.
- **`investorService` + controller + rutas** (espejo de comisiones):
  - Estado de cuenta por persona: devengado / pagado / pendiente + desglose por carro.
  - Pago desde una cuenta (reutiliza `PayablePayment`).
- **Página "Ganancia / Inversionistas"** (espejo de `/treasury/commissions`).
- **Card en Dashboard:** total pendiente a inversionistas + por persona.
- Auditoría: las CxP `PROFIT_SHARE` y sus pagos pasan por el mismo `treasuryAudit` que las comisiones.

## 10. Migración

- `ALTER TYPE "PayableType" ADD VALUE 'PROFIT_SHARE'` y
  `ALTER TYPE "ParticipantRole" ADD VALUE 'INVESTOR'` (idempotente / guardas).
- Seed idempotente de los settings nuevos con defaults.
- No seed de `investor_team` con ids desconocidos: se configura desde la UI (o queda en `[]` →
  fallback owner-self 100%).

## 11. Datos históricos

**Las ventas ya cerradas no se tocan.** El modelo nuevo aplica solo a ventas futuras. Las ventas
viejas conservan sus comisiones y pagos ya hechos; los reportes muestran cada venta con la lógica
con la que se creó.

## 12. Tests (TDD, espejo de los de comisión)

- **Unit:** `calculateSaleDistribution` (cascada, `skip`, redondeo que cuadra en ambos bloques);
  `resolveSellers` (suman 100, sin resto al dueño, errores); `resolveInvestors` (team, fallback
  owner-self, `ensureOwnerExists`); agregación por persona por tipo.
- **Integración:** `registerSale` crea ambas CxP (`COMMISSION` + `PROFIT_SHARE`) + reservas, atómico;
  reverso anula ambas.
- **E2E:** venta → aparece en Comisiones y en Inversionistas; pago a un inversionista; estado de cuenta.

## 13. Fuera de alcance (YAGNI)

- Rendimiento fijo pactado / interés a inversionistas (se eligió reparto de utilidades real).
- Inversionistas variables por carro (fondo común fijo).
- Backfill del histórico.
- Socio externo puntual en un carro (caso futuro, se trata aparte).

## 14. Riesgos

- Cambia el cálculo de comisión (de pool 60/30/10 a % de ganancia bruta) — flujo recién
  estabilizado en producción. Mitigación: TDD exhaustivo + `calculateSaleDistribution` puro y testeado
  antes de tocar `saleService`.
- Enum `ADD VALUE` en Postgres no corre dentro de transacción con otros cambios en algunas versiones;
  la migración lo aísla.
- El reverso debe cubrir `PROFIT_SHARE` o quedarían CxP huérfanas al cancelar una venta.
