# Spec: Identidad visual — reemplazo de emojis por Lucide React

- **Fecha:** 2026-06-18
- **Estado:** Aprobado (diseño)
- **Módulo:** Frontend — UI global

## Problema / objetivo

El proyecto usa ~137 emojis y glifos Unicode repartidos en ~30 archivos (nav, botones,
estados vacíos, configs de categorías/tabs, labels). Se quiere dar identidad visual
reemplazándolos por una librería de íconos consistente: **Lucide React** (`lucide-react`).

## Decisiones (confirmadas)

| Tema | Resolución |
|---|---|
| Librería | Lucide React |
| Alcance | Los 5 grupos de emojis/glifos (ver abajo) **+ íconos para las 6 etapas** del pipeline |
| Fuera de alcance | Logo, paleta, badges de PORTALES (marcas: TuCarro/OLX/… quedan como texto con su color) |

## Grupos a reemplazar

1. **Nav lateral** (`AppLayout`): `▦ ◩ ☰ ◈ ⊘ ⚙` → `LayoutGrid, BarChart3, Car, Wallet, Receipt, Settings`.
2. **Config-driven** (`constants.js`, `PayablesPage`): `EXPENSE_CATEGORIES.icon`, tabs CxC/CxP. El campo `icon` pasa de string emoji a **referencia a componente Lucide**.
3. **Botones inline**: `💸 Pagar`, `💰 Cobrar`, `🗑 Eliminar`, `✏ Editar`, `🔗 Reconciliar`, etc.
4. **Estados vacíos**: `✅ 🚗 💸 🏦 🔍` (grandes).
5. **Labels inline**: `👤 tercero`, `📅 fecha`, `🚗 vehículo`.

## Arquitectura

- **Mapeo concepto→ícono en un solo lugar:** en `constants.js`, `EXPENSE_CATEGORIES[].icon`,
  un nuevo `STAGES[].icon` y los íconos de nav/tabs pasan a ser referencias a componentes
  Lucide (no strings). La UI renderiza `const Icon = cat.icon; <Icon ... />`.
- **Usos inline:** import nombrado directo de `lucide-react` por archivo (tree-shaking).
- **Convención de estilo:** `size` 16 en botones/labels, 18–20 en nav, 40–44 en estados
  vacíos; color por `currentColor` heredando las clases Tailwind actuales; `strokeWidth` default.

## Íconos de etapas (nuevo `STAGES[].icon`)

`NEGOCIANDO→Handshake`, `COMPRADO→ShoppingCart`, `ALISTAMIENTO→Wrench`,
`PUBLICADO→Megaphone`, `DISPONIBLE→CircleCheck`, `VENDIDO→BadgeCheck`.

## Orden de implementación (un commit por área)

1. `constants.js` (configs + STAGES.icon) + `AppLayout` (nav).
2. Tesorería (Payables, Loans, Debts, Accounts, Treasury, widgets, modales).
3. Vehículos (Kanban, VehicleDetail, VehiclesPage, VehicleFormModal).
4. Gastos + shared (Alert, AlertsPanel, Modal, FormFields, DocumentCard, etc.).

## Testing / riesgos

- La mayoría de e2e selecciona por `data-testid` (no se afectan).
- **Riesgo:** tests que seleccionen por texto con emoji (ej. `name: /💸 Pagar/`). Se verifica
  con grep y se ajusta.
- Validación: `vite build` + suite e2e por área en verde.

## Fuera de alcance (YAGNI)

- Cambios de logo, tipografía o paleta.
- Íconos en badges de PORTALES.
- Nuevos tests unitarios para swaps puramente visuales (cubre build + e2e existente).
