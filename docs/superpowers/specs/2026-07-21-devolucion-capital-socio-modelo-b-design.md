# Devolución de capital al socio (Modelo B) — trazabilidad completa del ciclo compra→venta

**Fecha:** 2026-07-21
**Rama:** `feat/ganancia-inversionistas` (PR #54 → `dev`)
**Depende de:** FASE A (aporte del socio en la compra = egreso desde su cuenta SOCIO), la cascada de venta con socio (PARTNER_SHARE + comisión socio), y el enrutamiento a cuenta socio de FASE B.

---

## 1. Problema

Cuando un socio aporta capital en la compra (inversionista al 100% o externo por %), FASE A **debita ese capital de su cuenta SOCIO** en la compra, pero la venta **nunca se lo devuelve**: la cascada solo le acredita su *ganancia* (PARTNER_SHARE), no su *capital*. Resultado:

- Si el usuario cobra la venta en la cuenta del socio, la ganancia (PARTNER_SHARE, enrutada a esa misma cuenta) se cuenta **dos veces**.
- Si la cobra en una cuenta de empresa, el capital del socio **queda atrapado** en la empresa y su cuenta termina en negativo pese a un negocio rentable.

El ciclo de capital del socio no cierra. Este spec lo cierra con el **Modelo B (empresa como custodio)**: la venta entra a una cuenta de empresa y el socio recibe su capital y su ganancia por movimientos separados y rastreables.

## 2. Modelo de plata (ejemplo: compra 30M, venta 50M, inversionista 100%)

Config del ejemplo: comisión 10% del bruto, reinversión 30%, impuesto 10% sobre lo que queda tras comisión.

- Ganancia bruta = 50 − 30 = 20M; comisión = 2M; reservas = 5.4M + 1.8M = 7.2M; **ganancia socio (PARTNER_SHARE) = 12.8M**; **comisión que el socio adeuda = 2M**; **capital a devolver = 30M**.

| Movimiento | Instrumento | Monto | Efecto |
|---|---|---|---|
| Cobro de la venta | INCOME a cuenta empresa | 50M | empresa +50M |
| Devolución de capital | CxP `CAPITAL_RETURN` (nueva) | 30M | empresa −30M → socio +30M |
| Ganancia del socio | CxP `PARTNER_SHARE` (existe) | 12.8M | empresa −12.8M → socio +12.8M |
| Comisión que adeuda el socio | CxC `RECEIVABLE` (existe) | 2M | socio −2M → empresa +2M |
| Reservas (reinversión + impuesto) | apartado a budget (existe) | 7.2M | empresa −7.2M → fondo |
| Comisión a vendedores | CxP `COMMISSION` (existe) | 2M | empresa −2M → vendedores |

**Saldos:** cuenta socio = −30 + 30 + 12.8 − 2 = **+10.8M** (ganancia neta real, capital devuelto). Cuenta empresa neta = 0. Fondo +7.2M, vendedores +2M. Suma de ganancias 10.8 + 7.2 + 2 = 20M = bruto. ✔ Conserva.

La **única pieza nueva** es la CxP `CAPITAL_RETURN`; el resto ya existe.

## 3. Regla de creación

Al **registrar la venta** (`saleService`, mismo punto donde hoy se crean PARTNER_SHARE y la CxC de comisión): si `socio && Number(vehicle.partnerContribution) > 0`, crear una CxP:

```js
{
  type: 'CAPITAL_RETURN',
  status: 'PENDING',
  totalAmount: Number(vehicle.partnerContribution),
  paidAmount: 0,
  description: `Devolución de capital socio ${vehicle.plate}`,
  vehicleId,
  thirdPartyId: socio.thirdPartyId,
  createdBy: userId,
}
```

Regla uniforme: capital a devolver = `vehicle.partnerContribution` (lo que salió de la cuenta del socio en la compra). Inversionista 100% ⇒ = precio de compra; externo por % ⇒ = su aporte parcial. Como FASE A exige cuenta SOCIO activa para admitir el aporte, un socio con `partnerContribution > 0` siempre tiene cuenta destino para el enrutamiento.

## 4. Backend — cambios

1. **Schema + migración** (`backend/prisma/schema.prisma` + migración Prisma):
   - `enum PayableType` → agregar `CAPITAL_RETURN`.
   - `enum TransactionCategory` → agregar `CAPITAL_RETURN`.
   - Una migración con los dos `ALTER TYPE ... ADD VALUE`. No hay statements de migración que USEN los valores nuevos (solo el runtime), así que van en la misma migración sin problema.

2. **`saleService`** — crear la CxP `CAPITAL_RETURN` según §3, junto a las CxP existentes del socio, dentro de la misma `$transaction`.

3. **`payableService.addPayment`** — en la resolución de `transactionCategory`, mapear `payable.type === 'CAPITAL_RETURN'` → categoría `'CAPITAL_RETURN'` (hoy caería en `VEHICLE_PURCHASE` por tener `vehicleId`). Al pagarla, el enrutamiento FASE B ya crea egreso (cuenta empresa, cat. CAPITAL_RETURN) + ingreso (cuenta socio, cat. CAPITAL_RETURN).

4. **`payableService.getSocioPending`** — agregar un tercer bucket `capital`: CxP `type: 'CAPITAL_RETURN'`, `status: {in:['PENDING','PARTIAL']}`, mismo `include`/`orderBy` y misma forma de `Item` que los otros buckets. Respuesta pasa a `{ capital, profit, commission }`.

5. **`payableService.getSummary`** — incluir `CAPITAL_RETURN` en la lista de tipos del agregado "por pagar" (payables) y en el conteo de vencidos, junto a `PAYABLE/COMMISSION/PROFIT_SHARE/PARTNER_SHARE`.

6. **`saleService.cancelSale` guard** — agregar `CAPITAL_RETURN` al `type: { in: [...] }` que bloquea cancelar una venta con obligaciones devengadas (hoy `COMMISSION`, `PROFIT_SHARE`, `PARTNER_SHARE`).

## 5. Frontend — cambios

1. **`SocioPendingWidget`** — agregar una tercera sección **"Capital por devolver"** para el bucket `capital`, ubicada **arriba** de "Ganancia por pagar" (acento rojo/egreso, misma estructura de filas). Clic en una fila → `PaymentModal` `type='expense'`, `title='Devolver capital al socio'`, `thirdPartyId={item.thirdParty?.id}` (enrutamiento FASE B), `defaultDescription` "Devolución de capital {placa}". Igual patrón que la sección de ganancia.

2. **`SalePaymentModal`** — ocultar las cuentas tipo `SOCIO` del selector de cobro de la venta. El selector simple CASH/TRANSFER (que hoy mapea `accounts.map(...)`) pasa a mapear solo cuentas no-SOCIO; el modo mixto ya usa `cashAccounts`/`bankAccounts` (CASH/BANK), que no incluyen SOCIO. Así el cobro nunca cae en la cuenta del socio (evita por diseño el doble conteo).

## 6. Testing

**Unit backend:**
- `calculateSaleDistribution`/`saleService`: con socio y `partnerContribution > 0`, la venta crea una CxP `CAPITAL_RETURN` = `partnerContribution` (casos inversionista 100% y externo %). Sin socio o `partnerContribution === 0` → no se crea.
- `payableService.addPayment`: pagar una CxP `CAPITAL_RETURN` a un socio con cuenta SOCIO → egreso (empresa, cat. CAPITAL_RETURN) + ingreso (cuenta socio, cat. CAPITAL_RETURN); `PayablePayment` liga el egreso.
- `payableService.getSocioPending`: incluye el bucket `capital` con las CxP `CAPITAL_RETURN` pendientes; excluye PAID/CANCELLED.
- `payableService.getSummary`: `CAPITAL_RETURN` suma en el total "por pagar".

**E2E (Playwright, round-trip inversionista 100%):**
- Compra 30M con socio inversionista desde su cuenta SOCIO (socio −30M).
- Venta 50M cobrada en una cuenta de empresa.
- `getSocioPending` lista el vehículo en `capital` (30M), `profit` (ganancia) y `commission`.
- Pagar `CAPITAL_RETURN` → cuenta socio sube 30M; sale del bucket `capital`.
- Pagar `PARTNER_SHARE` → cuenta socio sube la ganancia.
- Cobrar la comisión → cuenta socio baja la comisión.
- Saldo final de la cuenta socio = ganancia neta esperada (capital devuelto). Conservación verificada.

**Frontend:** `npm run build` + revisión visual del widget (3 secciones) y del `SalePaymentModal` (sin cuentas SOCIO en el cobro).

## 7. Archivos afectados

- `backend/prisma/schema.prisma` + migración — `CAPITAL_RETURN` en `PayableType` y `TransactionCategory`.
- `backend/src/services/saleService.js` — crear la CxP `CAPITAL_RETURN`; guard de `cancelSale`.
- `backend/src/services/payableService.js` — categoría en `addPayment`; bucket `capital` en `getSocioPending`; `CAPITAL_RETURN` en `getSummary`.
- `backend/src/services/__tests__/` — unit de saleService (creación) + payableService (categoría/getSocioPending/getSummary).
- `frontend/src/components/treasury/SocioPendingWidget.jsx` — tercera sección "Capital por devolver".
- `frontend/src/components/treasury/SalePaymentModal.jsx` — ocultar cuentas SOCIO del cobro.
- `frontend/src/lib/payablesApi.js` / helpers e2e — sin cambios de contrato (getSocioPending gana un campo `capital`).
- `tests/e2e/treasury/socio.spec.ts` (o spec dedicado) + `tests/helpers/api.ts` — round-trip + `capital` en el tipo de respuesta.

## 8. Fuera de alcance / follow-ups

- **Reverso simétrico** del leg de ingreso a la cuenta socio (follow-up #2 de FASE B) — no se amplía aquí.
- **Capital return en compras por cruce (trade-in):** el path `settleTradeInPurchase` es aparte; solo se crea `CAPITAL_RETURN` cuando `vehicle.partnerContribution > 0` (aporte real registrado).
