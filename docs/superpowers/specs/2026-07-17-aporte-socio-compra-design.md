# Diseño — Aporte del socio en la compra (Opción B)

**Fecha:** 2026-07-17
**Estado:** Aprobado (diseño) — pendiente plan de implementación
**Autor:** Juan Carlos + Claude
**Relacionado:** [[2026-07-17-socio-en-cascada-venta-design]]

## 1. Problema

Al comprar un carro con **socio**, el flujo actual se rompe (confirmado con datos reales del
vehículo NUEVO89: `purchasePrice=20M`, `partnerContribution=20M`, `participation=1.0`, CxP
`PAYABLE PENDING totalAmount 0`):

- **Bug 1 (frontend):** `participation` solo se recalcula al cambiar el *aporte del socio*
  (`onPartnerContributionChange`), NO al cambiar el *precio de compra*. Como al pasar a COMPRADO el
  form borra el precio y se re-ingresa, `participation` queda desactualizada (p. ej. 1.0). Al vender,
  `resolveSocio` hace `socioShare = 1 − participation = 0` → **el socio no se reconoce** y su aporte
  se ignora.
- **Bug 2 (backend):** la CxP de compra se crea por *mi parte* (`precio − aporte`), con status
  PENDING. Con socio al 100%, `myOwedAmount = 0` → CxP en $0 PENDING. No hay pago que hacer
  (cualquier pago "excede tu parte de $0") y nada cierra una CxP de $0 → el guard de etapa exige
  `PAYABLE PAID` → **el vehículo queda atascado en COMPRADO**.
- El aporte del socio **no se registra** en ningún lado (no hay trazabilidad de su plata).

## 2. Modelo nuevo (Opción B, confirmado)

La CxP de compra pasa a ser por el **precio total**, y se salda con abonos. El aporte del socio
**pasa por una cuenta tuya** (entra como ingreso, sale al proveedor; neto $0), quedando trazado.

### Flujo al registrar/confirmar la compra con socio (aporte $X, precio $P, cuenta A)

1. **CxP `PAYABLE`** con `totalAmount = P` (precio total), `status PENDING`. Descripción
   `Compra vehículo {placa}` (sin "(mi parte)").
2. **Aporte del socio ($X)** — dos transacciones en la cuenta A (neto $0):
   - `INCOME`, categoría `CAPITAL_CONTRIBUTION`, `thirdPartyId = socio`, monto X,
     desc `Aporte socio {nombre} — compra {placa}`.
   - `EXPENSE`, categoría `VEHICLE_PURCHASE`, `thirdPartyId = proveedor`, monto X,
     desc `Pago compra {placa} (aporte socio)` + `PayablePayment(X)` contra la CxP.
3. **Tu parte ($P − X)** — como hoy: `EXPENSE` desde tu cuenta, categoría `VEHICLE_PURCHASE`,
   `thirdPartyId = proveedor`, + `PayablePayment(P − X)` contra la CxP.
4. **CxP `paidAmount = X + (P−X) = P` → `status PAID`** → el guard de etapa pasa; avanzas libre.

### Casos
- **Socio externo (parcial):** X = aporte parcial; tu parte = P − X. Ambos abonos → CxP PAID.
- **Socio inversionista al 100%:** X = P; tu parte = $0. Solo los dos movimientos del socio saldan
  la CxP → PAID. Ya no se atasca.
- **Sin socio:** idéntico al comportamiento actual (CxP = P, tus pagos como hoy). Regresión cero.
- **Compra parcial (a crédito):** si al registrar no se cubre todo P, la CxP queda `PARTIAL`; el saldo
  se abona después con `addPurchasePayment` (comportamiento actual, sobre la CxP de precio total).

### Cuadre de dinero (ejemplo P=20M, socio externo X=8M)
```
CxP totalAmount             20M
Aporte socio: INCOME +8M, EXPENSE −8M en cuenta A  → neto cuenta A: 0; abono CxP: 8M
Tu parte:     EXPENSE −12M en cuenta B             → neto cuenta B: −12M; abono CxP: 12M
CxP paidAmount = 8M + 12M = 20M → PAID
Tu costo real de caja = 12M (tu parte). El socio aportó 8M (trazado). ✅
```

## 3. Fix del bug de `participation` (frontend)

`participation` debe **derivarse** de `purchasePrice` + `partnerContribution` de forma reactiva
(recalcular cuando cambie CUALQUIERA de los dos), no solo al tocar el aporte. Se somete
`participation = (precio − aporte) / precio` (acotado a [0,1]); con aporte = precio → 0.
Esto garantiza que `resolveSocio` reconozca al socio al vender.

## 4. Cambios de backend

- `purchaseService.createVehicleWithPurchase` y `confirmPurchase`: CxP `totalAmount = purchasePrice`
  (no `myOwedAmount`). Recibir el **aporte del socio** (monto + cuenta) además de los pagos propios.
- `purchaseService.applyPurchasePayments` (o una función hermana): cuando hay socio, generar el par
  INCOME+EXPENSE del aporte y su `PayablePayment`, además de los pagos propios; el status se calcula
  contra `purchasePrice` (no `myOwedAmount`). Un aporte + pagos que cubren P → `PAID`.
- El monto del aporte del socio se toma de `partnerContribution` (fuente única); la cuenta del aporte
  se recibe del cliente (por defecto la cuenta de pago principal).
- Guard de sobre-pago: aporte + pagos propios no pueden exceder `purchasePrice`.

## 5. Cambios de frontend (`VehicleFormModal`)

- `participation` derivada reactivamente (fix bug 1).
- Sección de socio muestra: *"Aporte del socio: $X · Tu parte: $(P−X)"* con claridad; ya no habla de
  "tu parte a pagar $0" sin contexto.
- La sección de pago envía el **aporte del socio** (monto + cuenta) junto con tus pagos. Con socio al
  100%, no exige que pagues nada de tu parte (es $0), pero sí registra el aporte del socio.

## 6. Fuera de alcance (YAGNI)

- Devolución del **capital** del socio al vender (sigue sin modelarse).
- Registrar el aporte del socio en una pantalla aparte posterior (se hace en el registro/confirmación
  de la compra).
- Aporte del socio en varios pagos/cuentas (un aporte, una cuenta).

## 7. Tests

- **Unit (`purchaseService`/helper):** con socio externo (X parcial) → CxP total = P, paidAmount = P,
  status PAID, 3 transacciones (INCOME aporte, EXPENSE aporte, EXPENSE tu parte), neto cuenta del
  aporte = 0. Socio 100% → tu parte 0, CxP PAID con solo el par del socio. Sin socio → comportamiento
  actual idéntico (regresión). Sobre-pago (aporte+pagos > P) → 400.
- **Unit (frontend, si aplica) / e2e:** `participation` derivada correctamente al ingresar precio
  después del aporte (o e2e: comprar con socio, verificar participation persistida y que al vender el
  socio se reconoce).
- **E2E:** comprar carro con socio (externo y 100%) → CxP PAID, avanzar de etapa OK, movimientos del
  aporte visibles; luego vender → el socio se reconoce (PARTNER_SHARE, etc.).

## 8. Riesgos

- Toca el flujo de compra (producción). Mitigación: TDD; el path sin-socio debe quedar byte-idéntico.
- El guard de etapa (`vehicleService.js:440`) ya exige `PAYABLE PAID`; con el modelo nuevo la CxP sí
  llega a PAID, así que no se toca ese guard.
- La CxP ahora es por el precio total: verificar que ningún reporte que asumía "CxP = mi parte" se
  rompa (buscar consumidores de la CxP de compra).
