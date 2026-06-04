# Comisiones y bolsillos — Fase 1 (Infraestructura)

**Fecha:** 2026-06-04
**Estado:** Diseño aprobado, pendiente plan de implementación
**Próximo paso:** `writing-plans` skill

## Resumen ejecutivo

Introducir un esquema de comisiones por venta y tres "bolsillos" presupuestales (comisiones, reinversión, impuestos) sobre la ganancia de cada vehículo vendido, con transferencias automáticas a cuentas de Tesorería reales. Esta fase es **API-first**: implementa toda la lógica subyacente con UI mínima, dejando para fases posteriores la asignación interactiva de participantes (F2), proyección (F3) y metas/históricos (F4).

## Contexto

El usuario tiene un negocio de compra-venta de vehículos en Colombia (AutoControl). Hoy las ganancias se calculan pero no se reparten formalmente: no hay un esquema explícito de comisiones para los vendedores ni un fondo de reinversión separado. El objetivo es:

- Motivar al equipo con comisiones por carro vendido
- Mantener una tesorería sana (capital separado para crecimiento)
- Apartar reservas para impuestos (DIAN)
- Soportar múltiples participantes por venta (rol captador + cerrador) con porcentajes flexibles

Esta fase entrega la **infraestructura base** que soportará todo lo demás.

## Decisiones de diseño (resueltas en brainstorming)

| # | Tema | Decisión |
|---|---|---|
| 1 | Quién recibe comisión | Yo + varios vendedores con roles distintos |
| 2 | Asignación por venta | Lista flexible de participantes con porcentajes |
| 3 | Base de cálculo | Ganancia (con socio: solo mi parte) |
| 4 | Timing | Devengada al registrar la venta |
| 5 | Bolsillos | Tres: comisiones + reinversión + impuestos (suma 100%) |
| 6 | Implementación bolsillos | Cuentas reales de Tesorería con transferencias automáticas |
| 7 | Sin caja (cruce, CxC) | Transfers solo del componente efectivo; comisiones igual devengadas |
| 8 | Split entre participantes | Default global + ajuste por venta |
| 9 | Pérdida | Cero comisiones, cero aportes |
| 10 | Pago al vendedor | Auto-CxP (un Payable tipo COMMISSION por participante) |
| 11 | Vehículo con socio | Base = mi parte después de socio |
| 12 | Proyección y metas | Diferido a F3 y F4 |

## Alcance de Fase 1

**Incluye:**

- Settings globales para los porcentajes y splits default
- Nuevas cuentas de Tesorería tipo `BUDGET` (Fondo Reinversión, Reserva Impuestos)
- Tabla `SaleParticipant`
- Nuevo tipo `Payable.type = COMMISSION`
- Lógica en `saleService.registerSale`: cálculo de base, creación de participantes (default o explícitos), creación de CxP por participante, transfers a cuentas BUDGET en proporción al efectivo recibido
- Extensión del API `POST /vehicles/:id/sell` con campo opcional `participants[]`
- Endpoint nuevo `GET/PUT /settings/commission-config`
- UI mínima: tipo BUDGET visible en lista de cuentas, sección "Comisiones y bolsillos" en SettingsPage (creándola si no existe)
- Bloqueo de `cancelSale` cuando hay CxP COMMISSION o Transfers asociadas
- Tests unitarios + 8 tests E2E

**Excluye (queda para fases siguientes):**

- F2: UI de selección de participantes dentro del modal de venta
- F3: Dashboard de proyección
- F4: Metas mensuales, leaderboard, reportes históricos
- Override por vehículo de los porcentajes globales
- Backfill retroactivo de ventas históricas

## Modelo de datos

### Settings (entradas nuevas)

```
commission_share_pct      = "60"
reinvest_share_pct        = "30"
tax_share_pct             = "10"
default_captador_pct      = "30"
default_cerrador_pct      = "70"
reinvest_account_id       = "<account-id>"
tax_reserve_account_id    = "<account-id>"
```

Validación al guardar:
- `commission_share_pct + reinvest_share_pct + tax_share_pct == 100`
- `default_captador_pct + default_cerrador_pct == 100`
- `reinvest_account_id` y `tax_reserve_account_id` apuntan a `Account` activas tipo `BUDGET`

### Account — nuevo valor de enum

```prisma
enum AccountType {
  CASH
  BANK
  BUDGET   // nuevo
}
```

Las cuentas BUDGET aparecen en el módulo de Tesorería pero en una sección "Fondos / Reservas" separada de las operativas, con badge visual distinto.

### Payable — nuevo valor de enum

```prisma
enum PayableType {
  PAYABLE
  RECEIVABLE
  COMMISSION   // nuevo
}
```

Una `Payable` tipo `COMMISSION` representa lo que se le debe a UN participante por UNA venta.

### Nueva tabla `SaleParticipant`

```prisma
model SaleParticipant {
  id            String           @id @default(cuid())
  vehicleId     String
  vehicle       Vehicle          @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  thirdPartyId  String
  thirdParty    ThirdParty       @relation(fields: [thirdPartyId], references: [id])
  role          ParticipantRole
  sharePct      Decimal          @db.Decimal(5, 2)   // 0..100, % del bolsillo comisiones
  amount        Decimal          @db.Decimal(15, 2)  // monto absoluto fijado al cierre
  payableId     String?          @unique
  payable       Payable?         @relation(fields: [payableId], references: [id])
  createdAt     DateTime         @default(now())

  @@index([vehicleId])
  @@index([thirdPartyId])
  @@map("sale_participants")
}

enum ParticipantRole {
  CAPTADOR
  CERRADOR
  OTHER
}
```

Invariante: para un mismo `vehicleId`, la suma de `sharePct` de todos los participantes activos debe ser 100. Validado en service.

### Seeds que crea la migración

- `Account "Fondo Reinversión"` tipo BUDGET, isActive=true, initialBalance=0
- `Account "Reserva Impuestos"` tipo BUDGET, isActive=true, initialBalance=0
- `ThirdParty "Dueño / Yo"` tipo EMPLOYEE, isActive=true (usado como default participante cuando el caller no envía la lista)
- Las siete entradas de Settings con sus valores default

## Lógica de negocio

### Cálculo de la base de comisión

Nueva función en `backend/src/utils/financial.js`:

```js
calculateCommissionBase(vehicle) → {
  grossProfitGlobal: number,   // salePrice - purchasePrice - totalDirectExpenses
  commissionBase:    number,   // grossProfitGlobal × participation
  skip:              boolean   // true si commissionBase <= 0
}
```

- `totalDirectExpenses` excluye expenses de categoría `COMISION` (legacy: las comisiones ya no se modelan como expense de vehículo)
- `participation` viene del campo existente en `Vehicle`
- Para vehículos con `fromTradeIn=true`, `purchasePrice = negotiatedValue` (ya saldado por el cruce)

### Flujo en `saleService.registerSale`

Después del paso 4 actual (creación opcional de CxC):

```
5. Liquidar bolsillos (solo si commissionBase > 0)

  5.1 Leer Settings de configuración (7 valores) y validar que existen.

  5.2 Calcular montos absolutos:
      commissionPool = commissionBase × (commission_share_pct / 100)
      reinvestPool   = commissionBase × (reinvest_share_pct / 100)
      taxPool        = commissionBase × (tax_share_pct / 100)

  5.3 Resolver participantes:
      - Si saleData.participants viene:
          validar que la suma de sharePct == 100
          validar que cada thirdPartyId existe
      - Si no viene:
          usar default — un participante:
            { thirdPartyId: <"owner-self" del seed>, role: CERRADOR, sharePct: 100 }

  5.4 Para cada participante, crear:
      - SaleParticipant con sharePct, amount = commissionPool × sharePct/100
      - Payable type=COMMISSION:
          totalAmount = SaleParticipant.amount
          paidAmount  = 0
          status      = PENDING
          thirdPartyId = participant.thirdPartyId
          vehicleId   = vehicleId
          description = "Comisión venta <plate> — <role>"
        Y enlazar payableId al SaleParticipant.

  5.5 Calcular cashReceived y cashRatio:
      cashReceived = totalReceived - tradeInValue
                     (suma de cashPayment + cashPayments, excluye trade-in)
      if totalReceived == 0:
        cashRatio = 0
      else:
        cashRatio = cashReceived / totalReceived

  5.6 Si cashReceived > 0:
      Crear Transfer:
        from = primera cuenta usada en cashPayment(s)
        to   = reinvest_account_id
        amount = reinvestPool × cashRatio
        description = "Reinversión venta <plate>"

      Crear Transfer:
        from = misma cuenta de arriba
        to   = tax_reserve_account_id
        amount = taxPool × cashRatio
        description = "Impuestos venta <plate>"
```

Todo dentro de la transacción Prisma existente (`prisma.$transaction`) — si cualquier paso falla, rollback total.

### Cancelación de venta

Extender `saleService.cancelSale`:

```js
if (saleHasCommissionPayables(vehicleId)) {
  throw new AppError(
    'No se puede cancelar: existen CxP de comisiones. Cancela o paga las comisiones primero.',
    400
  );
}
if (saleHasBudgetTransfers(vehicleId)) {
  throw new AppError(
    'No se puede cancelar: existen transferencias a fondos de reinversión/impuestos.',
    400
  );
}
```

Si el usuario realmente necesita cancelar, debe primero anular manualmente las CxP COMMISSION (cambiar status a CANCELLED) y reversar las transferencias.

## API

### Endpoint extendido

`POST /vehicles/:id/sell` acepta `participants[]` opcional:

```typescript
type SalePayload = {
  // ...campos actuales (salePrice, paymentType, buyerId, cashPayment, tradeIn, financing, etc.)
  participants?: Array<{
    thirdPartyId: string;
    role: 'CAPTADOR' | 'CERRADOR' | 'OTHER';
    sharePct: number;  // 0..100
  }>;
};
```

Response extendido:

```typescript
type SaleResponse = {
  vehicle, transactions, newVehicle, receivable,   // existentes
  summary: {
    // ...campos actuales
    commissionBase: number;
    commissionPool: number;
    reinvestPool: number;
    taxPool: number;
    cashRatioApplied: number;
    participants: Array<{
      id: string;
      thirdPartyId: string;
      role: 'CAPTADOR' | 'CERRADOR' | 'OTHER';
      sharePct: number;
      amount: number;
      payableId: string;
    }>;
    transfers: Array<{
      id: string;
      accountIdFrom: string;
      accountIdTo: string;
      amount: number;
      description: string;
    }>;
  };
};
```

### Endpoints nuevos

- `GET /settings/commission-config` → devuelve los 7 settings + las dos cuentas BUDGET vinculadas
- `PUT /settings/commission-config` → valida sumas y existencia de cuentas, actualiza. Requiere `role: ADMIN`.

## UI

### Cambios mínimos en F1

1. **Lista de cuentas (Tesorería → Cuentas)**: agregar sección "Fondos / Reservas" con las cuentas tipo BUDGET. Badge visual diferente (color/icono).

2. **SettingsPage**: crear si no existe. Sección "Comisiones y bolsillos" con:
   - Input para cada uno de los 7 settings
   - Validación visual: el total de los tres bolsillos debe ser 100, y el total del default split también
   - Botón "Guardar" deshabilitado mientras la validación falle
   - Solo visible para `role: ADMIN`

### Lo que NO se toca en F1

- `SalePaymentModal`: sigue como está. Sin selector de participantes (eso es F2).
- `VehicleDetailPage` (pestaña Tesorería): las CxP COMMISSION aparecen automáticamente sin cambios de UI.
- Dashboard: ningún panel nuevo (eso es F3).

## Testing

### Unit tests (`backend/src/utils/__tests__/financial.test.js`)

- `calculateCommissionBase`:
  - vehículo sin socio, ganancia positiva → base = grossProfit
  - vehículo con socio 50%, ganancia positiva → base = grossProfit × 0.5
  - vehículo con pérdida → `skip: true`, base = 0
  - vehículo con `fromTradeIn=true` → usa negotiatedValue como purchasePrice
  - expenses categoría `COMISION` (legacy) excluidas del total

### E2E tests (`tests/e2e/sales/commissions.spec.ts`)

1. Venta 100% cash → N CxP COMMISSION + 2 Transfers con montos correctos
2. Venta 100% cruce → CxP COMMISSION creadas pero 0 Transfers
3. Venta mixed (cash + cruce + CxC) → Transfers proporcionales al cash ratio
4. Venta con pérdida → 0 CxP COMMISSION, 0 Transfers
5. Venta con socio → base usa myProfit, no grossProfit
6. Custom participants payload → respeta split, valida suma 100
7. Default fallback → ThirdParty seeded "Dueño / Yo" como CERRADOR 100%
8. `cancelSale` bloqueado si hay CxP COMMISSION

### E2E UI mínimos

- SettingsPage muestra y guarda los 7 valores, valida sumas, rechaza no-admin
- Lista de cuentas muestra cuentas BUDGET en su sección

## Migración

Una sola migración Prisma:

```sql
-- 1) Nuevos valores en enums existentes (idempotente)
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'BUDGET';
ALTER TYPE "PayableType" ADD VALUE IF NOT EXISTS 'COMMISSION';

-- 2) Nuevo enum
CREATE TYPE "ParticipantRole" AS ENUM ('CAPTADOR', 'CERRADOR', 'OTHER');

-- 3) Nueva tabla sale_participants

-- 4) Seed accounts BUDGET (ON CONFLICT DO NOTHING)

-- 5) Seed ThirdParty "Dueño / Yo" (ON CONFLICT DO NOTHING)

-- 6) Seed settings (ON CONFLICT (key) DO NOTHING)
```

**No se hace backfill de ventas históricas.** Las ventas anteriores al deploy no generan CxP COMMISSION ni Transfers retroactivos. Es deliberado: las ganancias ya están consumidas y los balances ya están conciliados.

## Rollback

Si hay que revertir F1:

1. Eliminar Payables COMMISSION con `status = PENDING` (revisar antes)
2. Eliminar Transfers asociadas a cuentas BUDGET (revisar antes)
3. Drop `sale_participants`
4. Eliminar settings y cuentas BUDGET creadas por el seed
5. Los valores `BUDGET` y `COMMISSION` agregados a los enums se quedan (Postgres no permite quitarlos limpiamente sin recrear el tipo). Es aceptable.

En la práctica preferimos hot-fix forward que rollback.

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| El usuario olvida configurar Settings antes de la primera venta post-deploy | La migración siembra defaults razonables (60/30/10, 30/70). Funciona out-of-the-box. |
| Una venta tiene `commissionBase ≤ 0` por gastos altos no esperados | Skip silencioso, log informativo en response.summary indicando `skipped: 'loss'`. |
| El caller envía `participants[]` con suma ≠ 100 | Validación en service → 400 con mensaje claro. |
| El tercero "owner-self" se elimina manualmente | El default fallback fallaría. Mitigación: hacer el ThirdParty system-protected (no eliminable). Lo agregamos en la migración. |
| Conflicto con expenses categoría `COMISION` legacy | Los excluimos del cálculo de base. La categoría sigue existiendo pero documentamos que está deprecada para nuevos usos. |
| Cancelar venta con CxP COMMISSION ya pagadas | Bloqueo del cancelSale. El usuario debe primero anular/revertir las CxP manualmente. |

## Métricas de éxito

- 100% de las ventas registradas post-deploy con `commissionBase > 0` generan exactamente N CxP COMMISSION (uno por participante)
- 100% de los pagos en efectivo generan los dos Transfers a cuentas BUDGET con montos proporcionales
- Configuración de Settings se valida antes de guardar
- Cero ventas históricas afectadas
- Suite E2E al 100% verde tras la implementación

## Próximos pasos

1. Revisar este spec
2. Invocar `writing-plans` skill para crear el plan de implementación detallado
3. Implementar siguiendo TDD (RED → GREEN → REFACTOR) por checkpoint
4. PR único con todos los cambios de F1
5. Validar en producción antes de empezar F2
