# Spec: Vista de detalle de préstamos y créditos (ruta nueva)

- **Fecha:** 2026-06-15
- **Estado:** Aprobado (diseño)
- **Módulo:** Frontend — Tesorería → Préstamos (`/treasury/loans/:id`) y Créditos (`/treasury/debts/:id`)

## Problema / objetivo

La sección "Detalles" inline en la card lista todos los pagos; con créditos/préstamos de
muchas cuotas (ej. 60) la card se vuelve interminable. Se quiere una **ruta de detalle
dedicada** por préstamo y por crédito, con un **resumen** de cifras valiosas en una sola
vista, más el **historial de pagos** y el **cronograma de cuotas** en secciones separadas.

## Contexto del código

- Backend ya expone `GET /loans/:id` y `GET /debts/:id` (devuelven la entidad con
  `installments[]` y `payments[]`). **No requiere cambios de backend.**
- `treasuryApi`: `debtsApi.getById` ya existe; **falta** `loansApi.getById`.
- Rutas actuales: `treasury/loans`, `treasury/debts`. No hay rutas `:id`.
- Hoy las cards usan el componente `PaymentDetails` (colapsable) inline — se reemplaza.
- Campos disponibles:
  - **Loan:** `principalAmount, interestAmount, interestRate, paidAmount, interestReceived, extraReceived, status, disbursementDate, borrower{name}, originAccount{name}, installments[], payments[]`.
  - **Debt:** `name, lender, assetDescription, totalAmount, paidAmount, status, installments[], payments[]` (sin interés ni tasa).
  - **Installment:** `sequence, dueDate, plannedAmount, paidAmount, status` (PENDING/PARTIAL/PAID).
  - **Payment (loan):** `date, principalAmount, extraAmount, notes, account{name}`. **(debt):** `date, amount, notes, account{name}`.

## Decisiones de diseño (confirmadas)

| Tema | Resolución |
|---|---|
| Alcance | Préstamos **y** créditos |
| Rutas | `/treasury/loans/:id` y `/treasury/debts/:id` |
| Contenido | Resumen + historial de pagos + cronograma de cuotas (secciones separadas) |
| Card | Reemplazar el colapsable inline por un enlace "Ver detalle →" |
| Vista | Solo lectura (el pago se sigue registrando desde la card) |

## 1. Rutas y navegación

- `App.jsx`: agregar `<Route path="treasury/loans/:id" element={<LoanDetailPage />} />` y
  `<Route path="treasury/debts/:id" element={<DebtDetailPage />} />`.
- `treasuryApi.js`: agregar `loansApi.getById = (id) => api.get(`/loans/${id}`)`.
- `LoansPage`/`DebtsPage`: **quitar** el `<PaymentDetails>` inline de la card y agregar un
  enlace `Ver detalle →` (react-router `<Link>`) a la ruta de detalle correspondiente
  (`data-testid={`loan-card-${id}-detail-link`}` / `debt-card-...`). El botón "Registrar
  pago" se mantiene.

## 2. Resumen (KPIs)

**Préstamo:** Valor prestado (`principalAmount`) · Tasa pactada (`interestRate` %) ·
Cuotas pagadas / pactadas · Valor pagado (`paidAmount`) · Intereses pagados
(`interestReceived`) · Saldo pendiente (`principalAmount + interestAmount − paidAmount`).

**Crédito:** Valor financiado (`totalAmount`) · Cuotas pagadas / pactadas ·
Valor pagado (`paidAmount`) · Saldo pendiente (`totalAmount − paidAmount`).
(No muestra tasa ni intereses: el modelo de créditos no los maneja.)

Cálculos: cuotas pagadas = `installments.filter(i => i.status === 'PAID').length`;
pactadas = `installments.length`.

## 3. Historial de pagos (sección)

Reutiliza `PaymentDetails` con un nuevo prop `alwaysOpen` (cuando es true, renderiza la
lista expandida sin el toggle). Filas: fecha · valor total · cuenta · observación.
- Loan: `amount = principalAmount + extraAmount`.
- Debt: `amount = amount`.

## 4. Cronograma de cuotas (sección)

Nuevo componente compartido `InstallmentSchedule` (`frontend/src/components/treasury/InstallmentSchedule.jsx`):
- Props: `installments` (array crudo de la entidad).
- Tabla: **#** (sequence) · **Vence** (`formatDate(dueDate)`) · **Monto** (`plannedAmount`) ·
  **Pagado** (`paidAmount`) · **Estado**.
- Estado: `PAID`→"Pagada", `PARTIAL`→"Parcial", `PENDING`→"Pendiente"; si
  `status !== 'PAID' && new Date(dueDate) < now` → "Vencida" (resaltada en rojo).
- Contenedor con `max-h` + `overflow-y-auto` para soportar 60+ cuotas sin romper el layout.

## 5. Páginas de detalle

`LoanDetailPage.jsx` / `DebtDetailPage.jsx`:
- Leen `:id` de la URL (`useParams`), cargan con `loansApi.getById` / `debtsApi.getById`.
- Estructura: encabezado con nombre/deudor + estado + link "← volver" a la lista; grid de
  KPIs (resumen); sección "Pagos" (`PaymentDetails alwaysOpen`); sección "Cronograma"
  (`InstallmentSchedule`).
- Estados de carga y "no encontrado" (404 → mensaje + link a la lista).
- Solo lectura; accesible a todos los roles (incluido VIEWER).

## 6. Componentes/archivos

- Crear: `frontend/src/pages/treasury/LoanDetailPage.jsx`, `frontend/src/pages/treasury/DebtDetailPage.jsx`, `frontend/src/components/treasury/InstallmentSchedule.jsx`.
- Modificar: `frontend/src/components/treasury/PaymentDetails.jsx` (prop `alwaysOpen`), `frontend/src/lib/treasuryApi.js` (`loansApi.getById`), `frontend/src/pages/treasury/LoansPage.jsx` y `DebtsPage.jsx` (enlace en vez de inline), `frontend/src/App.jsx` (rutas).

## 7. Tests (E2E Playwright, sin migración)

- **Préstamo:** crear préstamo con interés + un pago vía API; en `/treasury/loans` click
  en "Ver detalle" → la URL es `/treasury/loans/:id`; el resumen muestra la tasa y
  "cuotas pagadas/pactadas"; la sección de pagos muestra el pago (observación); el
  cronograma muestra filas con estado.
- **Crédito:** mismo flujo en `/treasury/debts/:id` (sin tasa/intereses en el resumen).

## Fuera de alcance (YAGNI)

- Cambios en backend o en `/treasury/transactions`.
- Acciones de escritura (registrar/editar pago) dentro de la vista de detalle.
- Paginación server-side de cuotas/pagos (se listan todas con scroll en el cliente).
- Exportar/descargar el detalle.
