# Comisiones — Equipo de reparto dinámico + métricas por persona — Diseño

Fecha: 2026-07-13 · Estado: aprobado por el usuario · Rama objetivo: `dev`

## Problema

El reparto de comisiones por venta está limitado a 2 filas fijas
(captador/cerrador) en la UI, aunque el backend ya acepta N participantes. El
negocio real del usuario reparte cada venta entre un equipo recurrente — él
(administrador), su vendedor y sus papás — y necesita:

1. Repartir el bolsillo de comisión entre **hasta 5 personas** (sin contarse
   él: su parte es el resto, automática).
2. Definir ese equipo **una vez** y que cada venta lo aplique sola, con ajuste
   puntual por venta.
3. **Métricas**: cuánto se paga en comisiones y a quién — visibles en el
   Dashboard (card que navega a `/treasury/commissions`) y por persona.

## Decisiones del usuario (cerradas)

1. **Reparto en dos niveles**: equipo default en Settings + edición por venta.
2. **Tu parte = el resto, automática** — el dueño nunca es fila editable; la UI
   muestra "Tu parte: X%" en vivo. Contrato backend pasa de "suma = 100" a
   "suma ≤ 100 y el resto va a `owner-self`".
3. **Roles**: Captador / Cerrador / Otro (enum `ParticipantRole` existente —
   cero migraciones). Los papás van como "Otro".
4. **Dashboard**: card "Comisiones" con *Pendientes $X · Pagado este mes $Y*,
   clic → `/treasury/commissions`.
5. **Métrica por persona**: sección "Por persona" arriba del listado por carro
   en CommissionsPage (pagado histórico, pendiente, # ventas; incluye al dueño).
6. **Máximo 5 personas** por venta sin contar al dueño (UI y backend).

## Enfoque (aprobado: A)

- **Equipo default como Setting JSON** — key `commission_default_team`, valor
  `[{thirdPartyId, role, sharePct}]` en la tabla `Setting` existente (mismo
  patrón que los % de bolsillos). **Sin migración.**
- `resolveParticipants` gana la regla del resto-al-dueño y el default de equipo.
- Endpoint ligero **`GET /api/commissions/summary`** (agregados en DB) alimenta
  la card del Dashboard y la sección "Por persona".
- Componente de filas de reparto **compartido** entre Settings y el modal de
  venta.

Descartado: B (tabla `CommissionTeam` — migración y CRUD para un único registro
de configuración; YAGNI).

## Reglas de reparto (contrato)

Ejemplo — bolsillo de comisión $3.000.000:

| Fila | % | Resultado al vender |
|---|---|---|
| Vendedor (CAPTADOR) | 30% | CxP $900.000 |
| Papá (OTRO) | 15% | CxP $450.000 |
| Mamá (OTRO) | 15% | CxP $450.000 |
| **Dueño (resto, automático)** | **40%** | CxP $1.200.000 |

1. Venta sin `participants` en el payload:
   - Existe `commission_default_team` no vacío → se usa + fila del dueño por el
     resto.
   - No existe/vacío → comportamiento actual (fallback legacy
     `default_captador_pct`/`default_cerrador_pct` al dueño). Ventas históricas
     y flujos existentes intactos.
2. Venta con `participants` (edición puntual): máx 5, suma ≤ 100 (tolerancia
   0.001), sin `thirdPartyId` repetidos, cada `sharePct > 0`, terceros deben
   existir. El resto (100 − suma) genera la fila del dueño (`owner-self`, rol
   `OTHER`); si el resto es 0, el dueño no genera CxP.
3. `owner-self` NO es válido dentro de `participants` (su parte siempre es el
   resto) → 400 si llega.
4. Cada participante genera su `SaleParticipant` + CxP COMMISSION propia, como
   hoy (pago independiente por persona).

## Backend

**`commissionService`:**
- `resolveParticipants(prismaOrTx, saleParticipants, cfg)` — reescritura del
  contrato según las reglas de arriba. Nueva constante `MAX_PARTICIPANTS = 5`.
- `loadCommissionConfig` — lee además `commission_default_team` (JSON.parse
  defensivo: si está corrupto, se ignora con warning y aplica fallback legacy).
- `getSummary(prismaOrTx)` (nuevo) → `{ pendingTotal, paidThisMonth, byPerson }`
  con agregados Prisma (`groupBy`/`aggregate` sobre Payable COMMISSION +
  PayablePayment del mes en zona Bogotá — reusar `dayKeyBogota`/rango mensual):
  - `pendingTotal`: Σ (totalAmount − paidAmount) de CxP COMMISSION en
    PENDING/PARTIAL.
  - `paidThisMonth`: Σ PayablePayment.amount del mes actual (por createdAt) de
    payables COMMISSION.
  - `byPerson[]`: por `thirdPartyId` → `{ thirdParty: {id, name}, totalPaid,
    totalPending, salesCount }` (salesCount = # vehículos distintos con CxP de
    esa persona), orden por totalPending desc.

**Settings** (`settingsController` existente): `commission-config` GET/PUT
ganan el campo `commission_default_team` (array validado con Joi: máx 5 filas,
suma ≤ 100, terceros existentes, sin duplicados, sin owner-self).

**Rutas**: `GET /commissions/summary` en `routes/commissions.js` (antes del
`/:id` si existiera; hoy solo hay `/`).

## Frontend

**Componente compartido `frontend/src/components/treasury/CommissionSplitEditor.jsx`:**
- Props: `{ value: [{thirdPartyId, role, sharePct}], onChange, testidPrefix }`.
- Filas dinámicas: `ThirdPartySelector` + select de rol (Captador/Cerrador/Otro)
  + input % + botón quitar; "+ Agregar persona" (deshabilitado en 5).
- Línea viva "**Tu parte: X%**" (100 − suma; en rojo si la suma > 100).

**SettingsPage** (pestaña Comisiones): bloque "Equipo de reparto" con el editor,
guardado junto al resto del `commission-config`.

**SalePaymentModal**: la sección colapsada pasa a "Comisión — Reparto (default:
tu equipo)"; usa el editor precargado con el equipo default (fetch del config al
abrir, ya existe); sin tocar → no manda `participants` (default backend);
tocada → manda las filas del editor. Se elimina el par fijo captador/cerrador.

**CommissionsPage**: sección "**Por persona**" arriba de las cards (consume
`GET /commissions/summary.byPerson`): fila por persona con pagado histórico,
pendiente y # ventas.

**DashboardPage**: card "Comisiones" (*Pendientes $X · Pagado este mes $Y*),
clic → `navigate('/treasury/commissions')`. Consume el mismo summary.

## Casos borde

| Caso | Comportamiento |
|---|---|
| Sin equipo + venta sin tocar | Fallback legacy (todo al dueño) — históricos intactos |
| Equipo editado después | Solo ventas futuras; CxPs creadas no cambian |
| Tercero del equipo eliminado | Al vender: 400 "actualiza el equipo de reparto en Configuración" |
| % suman 100 | Tu parte $0 — sin CxP del dueño |
| >5 personas / duplicados / owner-self en filas | 400 backend + bloqueado en UI |
| Venta a pérdida (base ≤ 0, skip) | Sin comisiones, como hoy |
| JSON del equipo corrupto en Settings | Warning + fallback legacy (no rompe ventas) |
| Summary sin datos | Ceros y lista vacía (dashboard muestra $0) |

## Testing

- **Unit (node --test)**: `resolveParticipants` — default team + resto al dueño;
  suma ≤ 100; resto 0 sin fila dueño; máx 5 (400); duplicados (400); owner-self
  en filas (400); fallback legacy sin equipo; JSON corrupto → fallback.
  `getSummary` puro si se factoriza el armado (o e2e-only si requiere DB).
- **E2E (Playwright)**:
  1. Configurar equipo (Settings) → vender sin tocar comisión → CxPs correctas
     (personas + dueño por el resto) visibles en CommissionsPage.
  2. Pagar la CxP de una persona → sección "Por persona" y card del Dashboard
     reflejan pagado/pendiente; clic en la card navega a la página.
  3. Venta con ajuste puntual (editor en el modal, 2 personas custom).
- Suite backend completa + build + e2e treasury sin regresiones antes de merge.

## Fuera de alcance

- Reportes de comisiones por período/exportables.
- Roles/etiquetas personalizadas (requeriría migración).
- Cambiar el cálculo del bolsillo (base × %, intacto de Fase 1).
- Reverso de pagos de comisión (futuro, existe el motor universal).
