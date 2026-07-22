# Compra con socio inversionista 100%: ocultar cuentas de empresa, mostrar solo la cuenta del socio

**Fecha:** 2026-07-21
**Rama:** `feat/ganancia-inversionistas` (PR #54 → `dev`)
**Depende de:** FASE A (aporte del socio en la compra = un egreso desde su cuenta SOCIO; `VehicleFormModal` ya resuelve `socioAccount` por `partnerId`).

---

## 1. Problema

Al comprar un vehículo cuyo socio es **inversionista al 100%** (aporta todo el precio), el modal de compra (`VehicleFormModal`) sigue mostrando los selectores de cuentas de la empresa (Efectivo / Transferencia) para "tu parte a pagar". En ese caso tu parte es $0 y no sale nada de tu tesorería: la compra la paga por completo la cuenta del socio. Ver esos selectores confunde al usuario. Debe, en cambio, quedar claro/asociada la cuenta del socio de donde sale el dinero.

## 2. Alcance

Cambio **solo de frontend**, en `frontend/src/components/vehicles/VehicleFormModal.jsx`. Sin cambios de backend, API ni schema (el backend ya crea la CxP + el egreso por el precio completo desde la cuenta SOCIO cuando `partnerContribution === price` y no hay pagos de empresa).

## 3. Disparador

Dentro de la sección de pago (`showPaymentSection === true`), el caso "socio paga el 100%" se define por:

```
f.partnerId && myOwedAmount === 0
```

donde `myOwedAmount = Math.max(0, price - partnerAmt)` ya existe. `myOwedAmount === 0` (con `price > 0` y socio asignado) equivale exactamente a socio inversionista 100% (aporte = precio), porque la validación en vivo obliga: inversionista ⟺ aporte = precio; externo ⟺ aporte < precio. No se necesita chequear `isPartnerInvestor` por separado.

## 4. Comportamiento

Cuando el disparador es verdadero:

- **Ocultar** el bloque de pago con cuentas de empresa: los selectores "Efectivo — Cuenta" y "Transferencia — Cuenta", sus inputs de monto, los botones rápidos ("Todo en efectivo", etc.) y los avisos de saldo/CxP asociados a esos pagos.
- **Mostrar en su lugar** una línea de solo lectura con la cuenta del socio como fuente única (cuando `socioAccount` existe):
  > 🤝 La compra se paga completa desde la cuenta del socio: **{socioAccount.name}** — **{formatCurrency(price)}**. No sale nada de tu tesorería.
- **Si el socio no tiene cuenta SOCIO activa** (`!socioAccount`): NO mostrar la línea anterior; mantener el aviso/error existente ("El socio no tiene una cuenta activa para registrar su aporte") — tal como ya lo hace la sección "Aporte del socio". El guardado sigue bloqueado por la validación actual (`partnerAmt > 0 && f.partnerId && !socioAccount`).

Cuando el disparador es falso (socio externo con tu parte > 0, o compra sin socio): **sin cambios** — se muestran los selectores de empresa igual que hoy.

## 5. Guardado

- Cuando `myOwedAmount === 0`, no se debe enviar ningún pago de empresa: `purchasePayments` queda vacío. Para evitar residuos si el usuario venía de un socio parcial y cambió a 100% (montos de efectivo/transferencia en estado), el guardado debe **ignorar** `cashPay`/`transferPay` cuando `myOwedAmount === 0` (no empujarlos a `purchasePayments`, y no dispararles validaciones de "selecciona cuenta"/"overpay").
- El resto del payload (partnerContribution = precio, participation = 0, etc.) no cambia. El backend crea la CxP por el precio y el egreso desde la cuenta SOCIO.

## 6. Testing

- **E2E (Playwright, API-driven):** el flujo de compra con socio inversionista 100% desde la cuenta SOCIO ya está cubierto por `tests/e2e/treasury/cuentas-socio.spec.ts` (compra 100% desde la cuenta SOCIO → CxP PAID, avance de etapa, sin requerir cuenta de empresa). Se verifica que ese caso sigue verde; si aplica, se refuerza con una aserción explícita de que la compra 100% no envía `payments` de empresa y aun así deja la CxP en PAID. (El cambio es de UI; el contrato de backend no cambia.)
- **Frontend:** `npm run build` OK + revisión visual/manual del modal en los dos casos (socio 100% → sin selectores de empresa, con la línea de la cuenta socio; socio externo % / sin socio → selectores de empresa como hoy).

## 7. Archivos afectados

- `frontend/src/components/vehicles/VehicleFormModal.jsx` — condicionar el render del bloque de pago de empresa a `myOwedAmount > 0`; agregar la línea informativa de la cuenta socio para el caso 100%; ignorar `cashPay`/`transferPay` en el guardado cuando `myOwedAmount === 0`.
- (Posible) `tests/e2e/treasury/cuentas-socio.spec.ts` — aserción de refuerzo si se decide en el plan.
