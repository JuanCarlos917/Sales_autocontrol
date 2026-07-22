# Diseño — Cuentas dedicadas por socio, FASE A

**Fecha:** 2026-07-18
**Estado:** Aprobado (diseño) — pendiente plan de implementación
**Autor:** Juan Carlos + Claude
**Relacionado:** [[2026-07-17-aporte-socio-compra-design]] · FASE B (ganancias/comisiones a la cuenta del socio) — pendiente.

## 1. Problema / objetivo

Hoy el aporte del socio en la compra "pasa por una cuenta tuya" (INGRESO+EGRESO neto $0, Opción B).
El socio no tiene un lugar propio donde se vea su plata. Se quiere que **cada socio tenga una cuenta
dedicada** (como las CASH/BANK/BUDGET): con saldo, activable/desactivable, con transferencias — para
llevar mejor sus egresos/ingresos. FASE A cubre la **cuenta dedicada** y el **aporte de compra desde
esa cuenta**. FASE B (aparte) hará que las ganancias/comisiones entren a la cuenta.

## 2. Modelo (confirmado)

### Nuevo tipo de cuenta + vínculo
- `AccountType` += **`SOCIO`**.
- `Account` += `thirdPartyId String?` (FK a `ThirdParty`, `onDelete: SetNull`), + índice.
- Una cuenta `SOCIO` por socio, ligada a su tercero. Se comporta como cualquier cuenta: saldo
  (vía `accountService.calculateBalance`), `isActive` (activar/desactivar), transferencias a/desde
  otras cuentas (mecanismo `transferService` existente, que ya exige ambas cuentas activas).

### Creación automática
- Cuando un `ThirdParty` es o pasa a tipo **`PARTNER`** (Socio) — en `thirdPartyService.create` y
  `update` — el sistema crea su cuenta `SOCIO` dedicada si aún no tiene una (idempotente, una por
  persona), nombre por defecto `Cuenta Socio — {name}`, `initialBalance 0`, `isActive true`.
- La cuenta es editable/renombrable/desactivable como cualquiera. No se borra si tiene movimientos;
  si el tercero deja de ser socio, la cuenta queda (se puede desactivar).

### Aporte de compra desde la cuenta del socio (reemplaza Opción B)
- En la compra con socio, el aporte ($X = `partnerContribution`) sale como **EGRESO de la cuenta
  `SOCIO` del socio** hacia el proveedor (categoría `VEHICLE_PURCHASE`) + `PayablePayment(X)` contra
  la CxP (que sigue siendo por el precio total). Se **elimina** el par INGRESO+EGRESO por tu cuenta
  y el campo `payment.partnerAccountId` (ya no se pasa una cuenta tuya).
- Tu parte ($P − X) sale de tus cuentas como hoy.
- El sistema **resuelve** la cuenta del socio por `vehicle.partnerId` → su cuenta `SOCIO` activa. Si
  no existe o está inactiva → `AppError(400)` accionable ("El socio no tiene una cuenta activa; créala
  o actívala").
- **Regla 100%** queda cubierta por construcción: todo el aporte sale de la cuenta del socio.
- **Saldo insuficiente:** aviso de saldo negativo (no bloqueante, consistente con el flujo de compra
  actual — `applyPurchasePayments` ya emite `NEGATIVE_BALANCE` warnings). El socio debió depositar antes.

## 3. Cambios de backend

- **Esquema + migración:** `ALTER TYPE "AccountType" ADD VALUE 'SOCIO'`; `ALTER TABLE accounts ADD
  COLUMN "thirdPartyId"` (nullable, FK, index). Idempotente.
- **`thirdPartyService`:** helper `ensureSocioAccount(tx-or-prisma, thirdParty)` que crea la cuenta
  `SOCIO` si el tercero es PARTNER y no tiene una. Invocado tras `create`/`update` cuando el tipo es
  PARTNER. Backfill idempotente en la migración/seed para los socios existentes (mamá/papá, etc.).
- **`purchaseService.applyPurchasePayments`:** en la rama del socio, en vez de INCOME+EXPENSE por
  `partnerAccountId`, hacer **un solo EXPENSE desde la cuenta `SOCIO`** del socio (resuelta por
  `socioThirdPartyId`) + su `PayablePayment`. Resolver la cuenta: `account` con `type='SOCIO'`,
  `thirdPartyId=socioThirdPartyId`, `isActive=true`; si falta → 400. Emitir warning de saldo negativo
  con `computeAccountBalance`. Quitar `partnerAccountId` de la firma/uso.
- **`validation.js`:** quitar `payment.partnerAccountId` de los schemas de compra (ya no se usa).
- **`accountService`/cuentas:** permitir `type='SOCIO'` + `thirdPartyId` en create/update (schema Joi
  `account`), exponer `thirdParty`/nombre del socio en el listado.

## 4. Cambios de frontend

- **Pantalla de Cuentas:** las cuentas `SOCIO` se muestran (con el nombre del socio), se pueden
  activar/desactivar y transferir como las demás. (Crear socio-cuenta a mano es opcional; se crean
  solas al marcar Socio.)
- **`VehicleFormModal` (compra):** el aporte del socio ya **no** pide "cuenta por la que entra" tuya;
  usa la cuenta del socio automáticamente. Mostrar "Aporte del socio sale de: Cuenta Socio — {nombre}".
  Quitar el envío de `partnerAccountId`.

## 5. Fuera de alcance (FASE B / YAGNI)

- Que las **ganancias (`PARTNER_SHARE`) y comisiones ENTREN** a la cuenta del socio al pagarlas
  (FASE B, su propio diseño).
- Múltiples cuentas por socio; monedas; cuenta socio para `owner-self` (tú usas tus cuentas; si algún
  día te haces socio 100% de un carro, se resuelve marcándote/creando la cuenta — fuera de alcance).

## 6. Tests

- **Unit (`thirdPartyService`):** crear/editar un tercero a PARTNER → se crea su cuenta SOCIO
  (idempotente: segunda vez no duplica); tercero no-PARTNER → no crea.
- **Unit (`purchaseService.applyPurchasePayments`):** con socio, el aporte es UN EXPENSE desde la
  cuenta SOCIO del socio (no INCOME+EXPENSE por tu cuenta), + PayablePayment; CxP salda contra el
  precio total con tu parte. Socio sin cuenta activa → 400. Saldo insuficiente → warning.
- **E2E:** marcar un tercero como Socio → aparece su cuenta; comprar un carro con ese socio (parcial
  y 100%) → el aporte sale de la cuenta del socio, CxP PAID, avanzar de etapa OK; transferir desde la
  cuenta del socio a otra cuenta.

## 7. Riesgos

- Revisa el flujo de compra recién cambiado (Opción B): la rama del socio pasa de par-neto-0 a un
  EXPENSE desde la cuenta del socio. El path sin-socio y tu-parte quedan iguales.
- `ALTER TYPE ADD VALUE` (enum) aislado en su migración (patrón de `BUDGET`/`PROFIT_SHARE`).
- El backfill de cuentas para socios existentes debe ser idempotente.
- La cuenta SOCIO ligada a un tercero: al desactivar/borrar el tercero, `onDelete: SetNull` deja la
  cuenta sin dueño (no rompe); considerar no permitir borrar un tercero con cuenta con saldo (ya hay
  un guard de borrado de terceros con movimientos).
