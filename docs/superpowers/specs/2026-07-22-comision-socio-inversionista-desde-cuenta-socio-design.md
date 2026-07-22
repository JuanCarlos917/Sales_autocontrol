# Comisión del socio inversionista 100% pagada desde su cuenta — Design

**Fecha:** 2026-07-22
**Estado:** Aprobado (diseño) — pendiente plan de implementación

## Objetivo

Cerrar el margen de error en el pago de comisiones de una venta de **socio inversionista 100%**: en lugar de crear una CxC "Comisión socio venta" (que hay que *cobrarle* al socio y aparece como un ingreso suelto), el sistema debe:

1. Mostrar la **ganancia del socio neta de comisión**.
2. Depositar el **pool de comisión en la cuenta del socio** (línea "Comisión por pagar").
3. Hacer que **las comisiones de los vendedores se paguen desde la cuenta del socio**, ofreciendo en el modal de pago **solo esa cuenta**.

Con esto todo el dinero del negocio pasa y se salda por la cuenta del socio, sin CxC "por cobrar" que reconciliar.

## Alcance

- **Aplica solo a socio inversionista 100%** (`socio.isInvestor === true`, que en `resolveSocio` garantiza `share === 1`).
- **Socios externos parciales** (`share < 1`) **no cambian**: conservan el modelo actual (ganancia bruta por su share + CxC "Comisión socio venta" por cobrar). El reparto parcial no cuadra saliendo de la cuenta del socio, por eso queda fuera.
- No se amplía el reverso simétrico (follow-up existente de FASE B).

## Modelo financiero

Ejemplo de referencia: compra 30M, venta 60M, comisión 40%, reinversión 50%, impuesto 10%.

| Concepto | Cálculo | Monto |
|---|---|---|
| Ganancia bruta | 60 − 30 | 30.0M |
| Comisión (pool) | 40% × 30 | 12.0M |
| Base tras comisión | 30 − 12 | 18.0M |
| Reinversión | 50% × 18 | 9.0M |
| Impuesto | 10% × 18 | 1.8M |
| **Ganancia socio NETA** | 18 − 9 − 1.8 | **7.2M** |

**CxP/CxC creadas al vender (inversionista 100%):**

1. `CAPITAL_RETURN` = `partnerContribution` (30M) → cuenta del socio *(sin cambios)*.
2. `PARTNER_SHARE` = **ganancia neta** (7.2M) → cuenta del socio *(cambia: antes 19.2M bruta)*.
3. `COMMISSION_RETURN` = **pool de comisión** (12M) → cuenta del socio *(NUEVO; reemplaza la CxC "Comisión socio venta")*.
4. `COMMISSION` a cada vendedor (Σ 12M) → **se paga desde la cuenta del socio**.

**Flujo del dinero:**

```
Empresa recibe la venta:            +60.0M
Empresa → socio (3 transferencias): −49.2M  (capital 30 + ganancia 7.2 + comisión 12)
Empresa queda:                       10.8M  (= reinversión 9 + impuesto 1.8) ✓

Cuenta del socio:
  + capital 30.0  + ganancia 7.2  + comisión 12.0  − vendedores 12.0  = 37.2M
  (puso 30M → gana 7.2M reales) ✓
```

Los tres depósitos a la cuenta del socio (`CAPITAL_RETURN`, `PARTNER_SHARE`, `COMMISSION_RETURN`) usan el enrutamiento **FASE B** ya existente: egreso de una cuenta de empresa + ingreso a la cuenta SOCIO, misma categoría en ambos asientos.

## Cambios por capa

### 1. `backend/src/utils/financial.js` — ganancia neta del inversionista

En `calculateSaleDistribution`, rama `socio.isInvestor`:

```js
// antes: partnerProfit = grossProfit - reinvestAmount - taxAmount;
partnerProfit = afterCommission - reinvestAmount - taxAmount;
```

- Solo afecta ventas de inversionista **con** comisión. Sin vendedores, `commissionPool = 0` ⇒ `afterCommission = grossProfit` ⇒ resultado idéntico al actual (sin regresión).
- La rama externo-parcial (`else`) **no se toca**.

### 2. Schema + enum `COMMISSION_RETURN`

- `PayableType`: agregar `COMMISSION_RETURN` (último valor).
- `TransactionCategory`: agregar `COMMISSION_RETURN` (tras `CAPITAL_RETURN`).
- Dos migraciones idempotentes independientes (`ALTER TYPE ... ADD VALUE 'COMMISSION_RETURN'`), una por enum, siguiendo la convención del repo (`IF NOT EXISTS`, sin statements que usen el valor).

### 3. `backend/src/services/saleService.js`

Dentro de la `$transaction`, en el bloque del socio:

- Si `socio.isInvestor`: crear `COMMISSION_RETURN` con `totalAmount = dist.commissionPool`, `thirdPartyId = socio.thirdPartyId`, `vehicleId`, descripción `Comisión por pagar socio <plate>`. **No** crear la CxC `RECEIVABLE` "Comisión socio venta".
- Si **no** es inversionista: comportamiento actual sin cambios (crea la CxC `RECEIVABLE` cuando `partnerCommissionOwed > 0`).
- `PARTNER_SHARE` sigue creándose igual; su monto neto ya viene de `financial.js`.
- `cancelSale`: agregar `'COMMISSION_RETURN'` a la lista del guard de payables devengados.

### 4. `backend/src/services/payableService.js`

- `addPayment`: `isCommissionReturn = payable.type === 'COMMISSION_RETURN'`; categoría `COMMISSION_RETURN` (rama antes del fallback `VEHICLE_PURCHASE`). Enruta por FASE B como `CAPITAL_RETURN`/`PARTNER_SHARE`.
- `getSocioPending`: agregar bucket `commissionReturn` (payables `COMMISSION_RETURN` pendientes). Mantener el bucket `commission` actual (CxC de socios parciales). Retorno: `{ capital, profit, commissionReturn, commission }`.
- `getSummary`: agregar `'COMMISSION_RETURN'` a las dos listas `type: { in: [...] }` (por pagar + vencidos).

### 5. `backend/src/services/commissionService.js` — exponer el socio inversionista

`buildCommissionVehicleItem` debe incluir, en el ítem del vehículo, el socio inversionista para que el frontend restrinja la cuenta de pago:

```js
socioInvestor: socio && socio.isInvestor ? { thirdPartyId: socio.thirdPartyId } : null
```

(Resolver el socio con `resolveSocio` en el punto donde se arma el ítem, o propagar `partnerId` + flag ya calculado. El item hoy solo expone `cascade.participation`.)

### 6. Frontend

**`PaymentModal.jsx`** — nueva prop `originSocioThirdPartyId` (opcional). Cuando está presente y `type === 'expense'`, el selector de "Cuenta de origen" se restringe a **la cuenta SOCIO de ese tercero**:

```js
const originAccounts = originSocioThirdPartyId
  ? accounts.filter((a) => a.type === 'SOCIO' && a.thirdPartyId === originSocioThirdPartyId && a.isActive)
  : (socioDestAccount ? accounts.filter((a) => a.type !== 'SOCIO') : accounts);
```

Auto-seleccionar esa cuenta cuando es la única opción. No rompe el flujo actual (prop ausente ⇒ comportamiento igual).

**`CommissionsPage.jsx`** — al pagar una comisión de un vehículo con `item.socioInvestor`, pasar `originSocioThirdPartyId={item.socioInvestor.thirdPartyId}` al `PaymentModal`. Vehículos sin `socioInvestor` siguen ofreciendo todas las cuentas.

**`SocioPendingWidget.jsx`** — agregar la sección **"Comisión por pagar"** (rojo/egreso) alimentada por el bucket `commissionReturn`, entre "Ganancia por pagar" y "Comisión por cobrar". El pago de una fila usa FASE B (egreso empresa + ingreso socio), igual que ganancia/capital. La sección "Comisión por cobrar" (CxC, verde) permanece para socios parciales.

## Casos borde / guardas

- **Fondos en la cuenta del socio:** la comisión al vendedor solo puede salir si la cuenta del socio ya tiene saldo → el usuario paga primero capital/ganancia/comisión-por-pagar (que la llenan) y luego las comisiones. El backend ya valida "saldo insuficiente".
- **Vendedor que es el propio socio del vehículo:** pagar su `COMMISSION` desde la misma cuenta SOCIO dispararía el guard "la cuenta origen no puede ser la cuenta del socio destino" de FASE B. Caso raro; se deja como error explícito (no se maneja especial en esta iteración).
- **Sin vendedores:** `commissionPool = 0` ⇒ no se crea `COMMISSION_RETURN`; ganancia neta = bruta (sin cambio).

## Tests

- **Unit `financial.js`:** inversionista con comisión ⇒ `partnerProfit = afterCommission − reinv − imp` (7.2M en el ejemplo); inversionista sin comisión ⇒ sin cambio. Parcial sin cambio.
- **Unit `saleService`:** inversionista ⇒ crea `COMMISSION_RETURN = commissionPool` y **no** crea la CxC "Comisión socio venta"; parcial ⇒ crea la CxC y **no** `COMMISSION_RETURN`. `cancelSale` bloquea con `COMMISSION_RETURN` devengada.
- **Unit `payableService`:** pago de `COMMISSION_RETURN` ⇒ egreso empresa + ingreso socio, categoría `COMMISSION_RETURN`; `getSocioPending` expone `commissionReturn`; `getSummary` lo cuenta. Pago de `COMMISSION` (vendedor) desde cuenta SOCIO ⇒ egreso único desde esa cuenta.
- **E2E round-trip inversionista 100%:** vender ⇒ capital + ganancia neta + comisión-por-pagar a la cuenta del socio; pagar comisión de vendedor **solo** desde la cuenta del socio; verificar que las cuentas cuadran y el socio neto = ganancia real. En la UI de Comisiones, el selector ofrece únicamente la cuenta del socio.

## Fuera de alcance

- Socios externos parciales (sin cambios).
- Reverso simétrico de los nuevos asientos.
- Manejo especial del caso "vendedor == socio del vehículo".

## Self-review

- **Placeholders:** ninguno pendiente.
- **Consistencia:** `COMMISSION_RETURN` se usa idéntico en enum, creación (`saleService`), categoría/bucket/summary (`payableService`) y widget. El contrato de `getSocioPending` pasa de `{ capital, profit, commission }` a `{ capital, profit, commissionReturn, commission }` de forma consistente entre service, widget y helper E2E.
- **Balance:** el flujo del dinero cuadra (empresa retiene reinversión + impuesto; socio neto = ganancia real).
- **Alcance:** enfocado en inversionista 100%; parcial explícitamente intacto.
