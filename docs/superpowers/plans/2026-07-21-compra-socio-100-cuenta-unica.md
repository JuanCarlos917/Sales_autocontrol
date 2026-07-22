# Compra socio 100%: ocultar cuentas de empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En `VehicleFormModal`, cuando el socio es inversionista al 100% (tu parte = $0), ocultar los selectores de cuentas de empresa y mostrar solo la cuenta del socio como fuente del pago.

**Architecture:** Cambio de un solo archivo de frontend. Se deriva un flag `socioFundsFull` a partir de `myOwedAmount === 0` y se usa para (a) condicionar el render del bloque de pago de empresa, (b) mostrar la línea de la cuenta socio, y (c) evitar que el guardado envíe/valide pagos de empresa.

**Tech Stack:** React + Vite (frontend, ES Modules).

## Global Constraints

- Frontend ES Modules; UI en español; montos COP con `formatCurrency`.
- Disparador exacto: `showPaymentSection && !!f.partnerId && myOwedAmount === 0` (equivale a socio inversionista 100%: aporte = precio).
- Socio externo con tu parte > 0 y compra sin socio: **sin cambios** (selectores de empresa como hoy).
- Si el socio no tiene cuenta SOCIO activa (`!socioAccount`): no mostrar la línea de la cuenta socio; mantener el aviso/error existente. El guardado sigue bloqueado por la validación actual `partnerAmt > 0 && f.partnerId && !socioAccount`.
- Sin cambios de backend, API ni schema. El backend ya crea la CxP + el egreso por el precio completo desde la cuenta SOCIO cuando `partnerContribution === price` y `purchasePayments` está vacío.

---

### Task 1: `VehicleFormModal` — ocultar cuentas de empresa y mostrar la cuenta del socio en compra 100%

**Files:**
- Modify: `frontend/src/components/vehicles/VehicleFormModal.jsx`

**Interfaces:**
- Consumes: variables ya existentes en el componente — `showPaymentSection`, `f.partnerId`, `myOwedAmount`, `price`, `socioAccount`, `cashPay`, `transferPay`, `cashAccountId`, `transferAccountId`, `overpay`, `formatCurrency`, `partnerAmt`.
- Produces: nuevo `const socioFundsFull` y render/guardado condicionados a él. Sin cambios de firma/props.

- [ ] **Step 1: Derivar el flag `socioFundsFull`**

En `frontend/src/components/vehicles/VehicleFormModal.jsx`, justo después de la línea que define `socioAccount` (actualmente la línea con el comentario "Cuenta SOCIO del tercero seleccionado…" y `const socioAccount = ...`), agregar:

```jsx
  // Socio inversionista al 100%: aporta todo el precio, tu parte es $0. En ese
  // caso la compra se paga completa desde la cuenta del socio; no se muestran
  // (ni se usan) cuentas de la empresa.
  const socioFundsFull = showPaymentSection && !!f.partnerId && myOwedAmount === 0;
```

(`showPaymentSection` y `myOwedAmount` ya están definidos más arriba en el mismo scope de render.)

- [ ] **Step 2: Guardado — no validar ni enviar pagos de empresa cuando `socioFundsFull`**

En `handleSave`, dentro del bloque `if (showPaymentSection) { ... }` que valida los pagos, envolver SOLO las validaciones de efectivo/transferencia/overpay en `!socioFundsFull`, dejando intacta la validación de la cuenta del socio. Reemplazar:

```jsx
    if (showPaymentSection) {
      if (cashPay > 0 && !cashAccountId) { setSaveError('Selecciona la cuenta de efectivo'); return; }
      if (transferPay > 0 && !transferAccountId) { setSaveError('Selecciona la cuenta de transferencia'); return; }
      if (overpay) {
        setSaveError(`Los pagos (${formatCurrency(totalPaidNow)}) no pueden superar tu parte a pagar (${formatCurrency(myOwedAmount)})`);
        return;
      }
      if (partnerAmt > 0 && f.partnerId && !socioAccount) {
        setSaveError('El socio no tiene una cuenta activa para registrar su aporte');
        return;
      }
    }
```

por:

```jsx
    if (showPaymentSection) {
      if (!socioFundsFull) {
        if (cashPay > 0 && !cashAccountId) { setSaveError('Selecciona la cuenta de efectivo'); return; }
        if (transferPay > 0 && !transferAccountId) { setSaveError('Selecciona la cuenta de transferencia'); return; }
        if (overpay) {
          setSaveError(`Los pagos (${formatCurrency(totalPaidNow)}) no pueden superar tu parte a pagar (${formatCurrency(myOwedAmount)})`);
          return;
        }
      }
      if (partnerAmt > 0 && f.partnerId && !socioAccount) {
        setSaveError('El socio no tiene una cuenta activa para registrar su aporte');
        return;
      }
    }
```

- [ ] **Step 3: Guardado — no empujar pagos de empresa cuando `socioFundsFull`**

En `handleSave`, donde se construye `purchasePayments`, envolver los dos `push` en `!socioFundsFull`. Reemplazar:

```jsx
      // Pago dividido: una línea por método con monto > 0 (lo no cubierto queda como CxP)
      const purchasePayments = [];
      if (cashPay > 0 && cashAccountId) purchasePayments.push({ accountId: cashAccountId, amount: cashPay, method: 'CASH' });
      if (transferPay > 0 && transferAccountId) purchasePayments.push({ accountId: transferAccountId, amount: transferPay, method: 'TRANSFER' });
```

por:

```jsx
      // Pago dividido: una línea por método con monto > 0 (lo no cubierto queda como CxP).
      // Con socio al 100% (tu parte $0) no se usa ninguna cuenta de empresa: la compra
      // la salda el egreso del aporte desde la cuenta SOCIO (lo resuelve el backend).
      const purchasePayments = [];
      if (!socioFundsFull) {
        if (cashPay > 0 && cashAccountId) purchasePayments.push({ accountId: cashAccountId, amount: cashPay, method: 'CASH' });
        if (transferPay > 0 && transferAccountId) purchasePayments.push({ accountId: transferAccountId, amount: transferPay, method: 'TRANSFER' });
      }
```

- [ ] **Step 4: JSX — subtítulo condicional + línea de la cuenta socio**

En la sección de pago, reemplazar el párrafo introductorio:

```jsx
          <p className="text-[11px] text-[#6E7681] mb-3">
            Registra cuánto pagas en efectivo y/o por transferencia. Lo que no cubras queda como cuenta por pagar (CxP).
          </p>
```

por (subtítulo normal solo cuando NO es 100%, y línea de la cuenta socio cuando sí lo es):

```jsx
          {!socioFundsFull && (
            <p className="text-[11px] text-[#6E7681] mb-3">
              Registra cuánto pagas en efectivo y/o por transferencia. Lo que no cubras queda como cuenta por pagar (CxP).
            </p>
          )}
          {socioFundsFull && socioAccount && (
            <div className="mb-3 text-[12px] text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-md px-2.5 py-2 flex items-start gap-1.5" data-testid="vehicle-form-socio-funds-full">
              <Handshake className="w-4 h-4 mt-0.5 shrink-0" />
              <span>La compra se paga completa desde la cuenta del socio: <span className="font-semibold">{socioAccount.name}</span> — <span className="font-semibold">{formatCurrency(price)}</span>. No sale nada de tu tesorería.</span>
            </div>
          )}
          {socioFundsFull && !socioAccount && (
            <div className="mb-3 text-[12px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-2.5 py-2 flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>El socio no tiene una cuenta activa para registrar su aporte. Actívale una cuenta de socio para poder confirmar la compra.</span>
            </div>
          )}
```

(`Handshake` y `AlertTriangle` ya están importados y usados en este archivo.)

- [ ] **Step 5: JSX — ocultar los selectores de efectivo/transferencia cuando `socioFundsFull`**

Envolver los dos bloques de cuenta (el de "Efectivo — Cuenta" y el de "Transferencia — Cuenta", incluyendo sus `cashWarning`/`transferWarning`) en `{!socioFundsFull && (<> … </>)}`. Es decir, el fragmento que va desde el comentario `{/* Efectivo (cuentas tipo Caja) */}` hasta el cierre del `{transferWarning && (…)}` queda:

```jsx
          {!socioFundsFull && (
            <>
              {/* Efectivo (cuentas tipo Caja) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1 inline-flex items-center gap-1.5"><Banknote className="w-4 h-4" /> Efectivo — Cuenta</label>
                  <select
                    value={cashAccountId}
                    onChange={e => setCashAccountId(e.target.value)}
                    className="input w-full"
                    data-testid="vehicle-form-cash-account"
                  >
                    <option value="">Sin efectivo</option>
                    {cashAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Monto en efectivo</label>
                  <input
                    type="number"
                    value={cashAmount}
                    onChange={e => setCashAmount(e.target.value)}
                    className="input w-full"
                    min="0"
                    placeholder="0"
                    data-testid="vehicle-form-cash-amount"
                  />
                </div>
              </div>
              {cashWarning && (
                <div className="mt-1 text-xs text-amber-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3 shrink-0" /> La cuenta de efectivo quedará con saldo negativo.</div>
              )}

              {/* Transferencia (cuentas tipo Banco) */}
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1 inline-flex items-center gap-1.5"><Landmark className="w-4 h-4" /> Transferencia — Cuenta</label>
                  <select
                    value={transferAccountId}
                    onChange={e => setTransferAccountId(e.target.value)}
                    className="input w-full"
                    data-testid="vehicle-form-transfer-account"
                  >
                    <option value="">Sin transferencia</option>
                    {bankAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Monto en transferencia</label>
                  <input
                    type="number"
                    value={transferAmount}
                    onChange={e => setTransferAmount(e.target.value)}
                    className="input w-full"
                    min="0"
                    placeholder="0"
                    data-testid="vehicle-form-transfer-amount"
                  />
                </div>
              </div>
              {transferWarning && (
                <div className="mt-1 text-xs text-amber-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3 shrink-0" /> La cuenta de transferencia quedará con saldo negativo.</div>
              )}
            </>
          )}
```

(Los botones rápidos `{myOwedAmount > 0 && (…)}` y la fecha de vencimiento `{pendingAfterPayment > 0 && (…)}` ya se auto-ocultan cuando la parte es $0, así que no requieren cambio. El resumen "Precio de compra / Aporte socio / Tu aporte" se mantiene y sigue siendo informativo.)

- [ ] **Step 6: JSX — no mostrar el aviso de overpay cuando `socioFundsFull`**

Reemplazar:

```jsx
          {overpay && (
```

por:

```jsx
          {!socioFundsFull && overpay && (
```

- [ ] **Step 7: Build**

Run: `cd frontend && npm run build`
Expected: build OK, sin errores de sintaxis/JSX.

- [ ] **Step 8: Verificación manual (con backend+frontend levantados por el usuario)**

Casos a revisar en el modal de compra (crear vehículo o confirmar compra):
1. **Socio inversionista 100%** (partnerId = un inversionista/owner-self, aporte = precio → tu parte $0): NO aparecen los selectores Efectivo/Transferencia; aparece la línea "La compra se paga completa desde la cuenta del socio: {nombre} — {precio}". Guardar crea la CxP y el egreso desde la cuenta SOCIO (CxP queda PAID), sin pedir cuenta de empresa.
2. **Socio inversionista 100% sin cuenta SOCIO activa**: aparece el aviso ámbar y el guardado se bloquea con el error existente.
3. **Socio externo por %** (tu parte > 0): los selectores Efectivo/Transferencia aparecen como hoy.
4. **Sin socio**: los selectores aparecen como hoy.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/vehicles/VehicleFormModal.jsx
git commit -m "feat: compra con socio 100% oculta cuentas de empresa y muestra la cuenta del socio"
```

---

## Self-Review

**1. Spec coverage:**
- §3 disparador `partnerId && myOwedAmount === 0` → Step 1 (`socioFundsFull`).
- §4 ocultar selectores de empresa → Step 5; línea de cuenta socio / aviso sin cuenta → Step 4; overpay oculto → Step 6.
- §5 guardado sin pagos de empresa + sin validarlos → Steps 2-3.
- §4 casos "socio externo %" / "sin socio" sin cambios → `socioFundsFull` es falso en esos casos (aporte < precio ⇒ myOwedAmount > 0; sin socio ⇒ `!f.partnerId`), así que todos los bloques envueltos se renderizan/validan igual que hoy.
- §6 testing → Step 7 (build) + Step 8 (manual); backend sin cambios (cobertura e2e existente de compra 100% en `cuentas-socio.spec` sigue válida).

**2. Placeholder scan:** sin TBD/TODO; todo el JSX y la lógica están completos y transcritos del archivo real.

**3. Type/consistency:** `socioFundsFull` se usa idéntico en guardado (Steps 2-3) y render (Steps 4-6). Los `data-testid` existentes (`vehicle-form-cash-account`, etc.) se conservan dentro del wrap; se agrega `vehicle-form-socio-funds-full` para la línea nueva. `Handshake`/`AlertTriangle`/`Banknote`/`Landmark` ya están importados en el archivo.
