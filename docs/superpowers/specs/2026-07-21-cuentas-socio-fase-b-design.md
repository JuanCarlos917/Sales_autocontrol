# Cuentas dedicadas por socio — FASE B: Entrada de ganancias y comisiones

**Fecha:** 2026-07-21
**Rama:** `feat/ganancia-inversionistas` (PR #54 → `dev`)
**Depende de:** FASE A (`2026-07-18-cuentas-socio-fase-a-design.md`) — cuentas SOCIO, `Account.thirdPartyId`, `ensureSocioAccount`, exclusión de SOCIO del total de tesorería.

---

## 1. Problema

FASE A creó cuentas dedicadas por socio (`type: 'SOCIO'`, ligadas por `thirdPartyId`) y permitió que el **aporte de compra** salga de esa cuenta. Pero el otro lado del ciclo —lo que el socio **gana**— todavía no entra a su cuenta:

- La **ganancia del socio del carro** (`PARTNER_SHARE`) se paga como un egreso genérico desde una cuenta de la empresa; el dinero "desaparece" sin quedar registrado como saldo del socio.
- La **comisión** que se le paga a un socio (cuando el socio también es vendedor) tiene el mismo problema.

El socio no puede ver "cuánto tengo acumulado" ni decidir retirar o reinvertir, porque su cuenta nunca recibe esas entradas.

## 2. Objetivo

Que al **pagar** una CxP de tipo `PARTNER_SHARE` o `COMMISSION` a un tercero que tiene una **cuenta SOCIO activa**, el dinero:

1. **Salga** de la cuenta de la empresa elegida (egreso real de la empresa), y
2. **Entre** a la cuenta SOCIO del tercero (queda como su capital disponible).

…**preservando las categorías `PARTNER_SHARE` / `COMMISSION`** en ambos lados, para que los reportes por categoría (ganancias repartidas, comisiones pagadas) sigan siendo correctos. **No** se usa una categoría genérica de transferencia.

## 3. Regla de enrutamiento (única)

> **Todo pago de una CxP que NO sea RECEIVABLE, cuyo tercero tenga una cuenta SOCIO activa, entra a esa cuenta.**

- En la práctica esto cubre exactamente los dos casos deseados: `PARTNER_SHARE` (ganancia del socio) y `COMMISSION` (comisión al socio-vendedor). Un `PAYABLE` genérico a un socio también entraría, lo cual es consistente ("es plata que le queda al socio").
- **RECEIVABLE queda intacto:** una CxC (p. ej. la comisión que el socio *le debe* a la empresa, que la empresa *cobra*) sigue siendo un `INCOME` a la cuenta de la empresa. El enrutamiento solo aplica a lo que la empresa **paga** al socio.
- Si el tercero **no** tiene cuenta SOCIO activa → comportamiento actual sin cambios (un solo egreso desde la cuenta elegida).

## 4. Mecánica (preserva categorías)

Punto único de cambio: `payableService.addPayment(payableId, { accountId, amount, date, description }, userId)`.

Dentro de la `$transaction` existente, **después** de resolver `isReceivable` y **después** del guard de saldo, se decide la forma del asiento:

### Caso enrutado (tercero con cuenta SOCIO activa, y no es RECEIVABLE)

Resolver la cuenta destino:

```js
const socioAccount = payable.thirdPartyId
  ? await tx.account.findFirst({
      where: { type: 'SOCIO', thirdPartyId: payable.thirdPartyId, isActive: true },
    })
  : null;
```

Si `socioAccount` existe → crear **dos** transacciones con la **misma categoría** (`transactionCategory`, que ya vale `PARTNER_SHARE` o `COMMISSION`):

1. **EGRESO** desde `accountId` (cuenta de la empresa elegida):
   - `type: 'EXPENSE'`, `category: transactionCategory` (`PARTNER_SHARE` | `COMMISSION`)
   - `amount`, `date`, `vehicleId`, `thirdPartyId`, `createdBy`
   - descripción: la actual (`description || 'Pago realizado: …'`)
2. **INGRESO** a `socioAccount.id` (cuenta del socio):
   - `type: 'INCOME'`, `category: transactionCategory` (misma)
   - `amount`, `date`, `vehicleId`, `thirdPartyId`, `createdBy`
   - descripción: `Entrada a cuenta socio — <desc>` (marca el lado receptor en el extracto del socio)

El **`PayablePayment`** se liga a la transacción de **EGRESO** (la que representa que la empresa pagó y salda la CxP). El `paidAmount`/`status` de la CxP se actualizan igual que hoy.

**Conservación del dinero:** empresa `−amount`, cuenta socio `+amount`. Como las cuentas SOCIO están excluidas del total de tesorería (FASE A), el total de la empresa baja en `amount` — correcto: la empresa pagó la ganancia/comisión del socio.

### Caso no enrutado (sin cuenta SOCIO, o RECEIVABLE)

Comportamiento **idéntico al actual**: una sola transacción (`isReceivable ? INCOME : EXPENSE`) + `PayablePayment` + actualización de la CxP. Sin cambios de código observables.

## 5. Guards y bordes

- **Saldo:** el guard actual (`calculateBalance(accountId) >= paymentAmount`) ya cubre el egreso desde la cuenta de la empresa. El ingreso a la cuenta socio no requiere guard (entra plata).
- **Cuenta origen ≠ cuenta destino:** bloquear (400) si `accountId === socioAccount.id`. Pagar la ganancia del socio *desde su propia cuenta* no tiene sentido y dejaría un asiento espejo neto cero. Mensaje: `La cuenta origen no puede ser la cuenta del socio destino.`
- **Idempotencia de resolución:** `findFirst` con `isActive: true`; si el socio tiene la cuenta desactivada, no se enruta (cae al comportamiento actual: egreso simple). Esto es intencional — una cuenta desactivada no debe recibir movimientos.
- **Reverso:** el motor de reverso universal reversa transacciones por su vínculo con el `PayablePayment`. La CxP referencia solo el EGRESO; el INGRESO a la cuenta socio queda como movimiento de la cuenta socio. **Fuera de alcance de esta fase** dejar el reverso 100% simétrico de los dos asientos; se documenta como follow-up (ver §8).
- **Flujo de caja / sumarios mensuales (correctitud):** como el INGRESO a la cuenta socio es `type: 'INCOME'`, los sumarios que agregan por `type` sin filtrar cuenta lo contarían como ingreso de la empresa (y el EGRESO reflejo, aunque ese sí es flujo real de la empresa). El movimiento hacia/desde una cuenta SOCIO es capital del socio, **no** flujo de la empresa. Por consistencia con FASE A (que ya excluye SOCIO del saldo total), los sumarios brutos de `treasuryReportService` deben **excluir las transacciones de cuentas `type: 'SOCIO'`**:
  - `getDashboard` → el `groupBy` mensual (`realIncome`/`realExpense`).
  - `getCashFlow` → el `findMany` de transacciones del período.
  - Filtro Prisma: `where: { ..., account: { type: { not: 'SOCIO' } } }`.
  - Esto también corrige un caso preexistente de FASE A (el aporte de compra desde la cuenta socio inflaba el egreso mensual).

## 6. UI

Cambio mínimo en el modal/flujo de pago de CxP (donde hoy se elige `accountId`):

- Cuando la CxP es `PARTNER_SHARE`/`COMMISSION` **y** el tercero tiene cuenta SOCIO activa, mostrar una línea informativa bajo el selector de cuenta:
  > **Entra a:** Cuenta Socio — {nombre del socio}
- El selector de cuenta origen sigue mostrando cuentas de la empresa (no las SOCIO), y excluye la cuenta destino del socio.
- No se agrega ningún control nuevo: la cuenta destino se deriva automáticamente del tercero de la CxP.

## 7. Testing

**Unit (`payableService`)** — con Prisma mock/tx fake:

1. CxP `PARTNER_SHARE`, tercero con cuenta SOCIO activa → crea EGRESO (empresa, cat `PARTNER_SHARE`) + INGRESO (cuenta socio, cat `PARTNER_SHARE`); `PayablePayment.transactionId` = id del EGRESO; CxP `paidAmount`/`status` actualizados.
2. CxP `COMMISSION`, tercero con cuenta SOCIO activa → dos asientos, categoría `COMMISSION` en ambos.
3. CxP `PARTNER_SHARE`, tercero **sin** cuenta SOCIO → un solo EGRESO (comportamiento actual), sin INGRESO.
4. CxP `PARTNER_SHARE`, tercero con cuenta SOCIO **inactiva** → un solo EGRESO (no enruta).
5. RECEIVABLE cuyo tercero tiene cuenta SOCIO → un solo INGRESO a la cuenta de la empresa (no enruta).
6. `accountId === socioAccount.id` → 400.
7. Conservación: suma de saldos (empresa + socio) antes vs. después difiere en 0 para el par de asientos (la empresa baja lo que el socio sube).

**Unit (`treasuryReportService`)** — con Prisma mock:

8. `getDashboard`/`getCashFlow` excluyen del bruto mensual las transacciones cuya cuenta es `type: 'SOCIO'` (un INGRESO a cuenta socio no aparece en `realIncome`).

**E2E (Playwright)** — flujo real:
- Vender un carro con socio del carro → se genera la CxP `PARTNER_SHARE`.
- Pagarla eligiendo una cuenta de la empresa.
- Verificar: saldo de la cuenta empresa baja; saldo de la Cuenta Socio sube por el mismo monto; el total de tesorería (sin SOCIO) baja; el extracto del socio muestra la entrada con categoría "ganancia".

## 8. Fuera de alcance / follow-ups

- **Reverso simétrico** del par EGRESO+INGRESO (hoy la CxP solo referencia el EGRESO). Follow-up separado si se requiere reversar ambos lados atómicamente.
- **Retiro / reinversión** desde la cuenta socio (el socio saca su plata o la vuelve a poner en una compra). FASE A ya permite usar la cuenta socio como origen del aporte de compra; un flujo explícito de "retiro" es fase posterior.
- **Selección de cuentas SOCIO en arqueo** (heredado de FASE A follow-ups).

## 9. Archivos afectados

- `backend/src/services/payableService.js` — lógica de enrutamiento en `addPayment` (cambio principal de negocio).
- `backend/src/services/treasuryReportService.js` — excluir cuentas `type: 'SOCIO'` de los sumarios brutos (`getDashboard` mensual, `getCashFlow`).
- `backend/src/services/__tests__/payableService.test.js` — casos unit §7 (crear si no existe).
- Frontend: componente del modal de pago de CxP — línea informativa "Entra a: Cuenta Socio — {nombre}" y exclusión de la cuenta destino del selector.
- E2E: spec Playwright del flujo socio (extender el existente de FASE A si aplica).

Sin cambios de schema ni migraciones (todo se apoya en `Account.thirdPartyId` y `type: 'SOCIO'` de FASE A).
