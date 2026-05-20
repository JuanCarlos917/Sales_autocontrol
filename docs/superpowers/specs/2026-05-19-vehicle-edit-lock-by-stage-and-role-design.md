# Vehículo: lock de campos por etapa y rol + audit log — Design Spec

- **Fecha**: 2026-05-19
- **Estado**: Aprobado por usuario, listo para implementación

## Contexto

Hoy `VehicleFormModal` permite editar todos los campos en cualquier etapa salvo algunos bloqueos puntuales (precio si ya hay CxP, socio inmutable, etc.). Esto deja editar la **identidad física** del vehículo (placa, marca, modelo, año, color, km) incluso después de COMPRADO — riesgo: si un vehículo ya tiene historia (CxP, gastos, transacciones), cambiar la placa rompe trazabilidad.

Además, en VENDIDO la consistencia contable depende de que el vehículo quede congelado. Hoy se pueden editar campos sueltos.

Objetivos:
1. Bloquear edición de los 6 campos de **identidad** (placa, marca, modelo, año, color, kilometraje) una vez el vehículo pasa a COMPRADO o etapas posteriores, salvo para rol `ADMIN`.
2. En VENDIDO bloquear **todos los campos** sin excepción (admin tampoco edita).
3. Introducir un rol `SUPERVISOR` (default para nuevos usuarios) para diferenciar de `ADMIN`.
4. Auditar todos los updates a vehículos con `VehicleAuditLog` análogo a `ExpenseAuditLog`.

## Decisiones tomadas

| Pregunta | Respuesta |
|---|---|
| Rol "admin" | Nuevo rol fino: `enum Role { ADMIN, SUPERVISOR, VIEWER }`. Default cambia a SUPERVISOR. |
| Usuarios existentes | Mantienen su rol actual (todos ADMIN). El usuario downgradea manualmente los que correspondan. |
| VENDIDO lock | Absoluto. Incluye ADMIN. No hay escape hatch ni override. |
| Backend enforcement | 403 si el rol/etapa no permite. Defensivo, paridad con UI. |
| Audit log | Tabla `VehicleAuditLog` con userId, action, before, after, reason, createdAt. |
| Identity fields | placa, brand, model, year, color, km |
| Drag entre columnas | No es "edit" — sigue funcionando con sus validaciones actuales (`updateStage`). VENDIDO one-way ya está en E.3. |

## Schema

### Cambios en `User`

```prisma
enum Role {
  ADMIN
  SUPERVISOR  // NUEVO
  VIEWER
}

model User {
  ...
  role Role @default(SUPERVISOR)  // antes: ADMIN
  ...
  vehicleAuditLogs VehicleAuditLog[]  // back-relation
}
```

### Nueva tabla `VehicleAuditLog`

```prisma
model VehicleAuditLog {
  id        String             @id @default(cuid())
  vehicleId String
  vehicle   Vehicle            @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  userId    String
  user      User               @relation(fields: [userId], references: [id])
  action    VehicleAuditAction
  before    Json?
  after     Json?
  reason    String?
  createdAt DateTime           @default(now())

  @@index([vehicleId])
  @@index([userId])
  @@index([createdAt])
  @@map("vehicle_audit_logs")
}

enum VehicleAuditAction {
  CREATE
  UPDATE
  STAGE_CHANGE
  DELETE
}
```

### Relación en Vehicle

```prisma
model Vehicle {
  ...
  auditLogs VehicleAuditLog[]
}
```

### Migración

- Agregar valor `SUPERVISOR` al enum `Role` (no destructivo).
- Cambiar el default de `users.role` de `ADMIN` a `SUPERVISOR`.
- Crear tabla `vehicle_audit_logs` con sus índices y FKs.
- Crear enum `VehicleAuditAction`.
- No backfillear roles: existentes se quedan como están.

## Policy de edit por campo, etapa y rol

```
IDENTITY_FIELDS = { plate, brand, model, year, color, km }
OTHER_FIELDS    = { everything else editable today }
```

| Etapa | Campo identity, rol SUPERVISOR | Campo identity, rol ADMIN | Otros campos, SUPERVISOR | Otros campos, ADMIN |
|---|---|---|---|---|
| NEGOCIANDO | ✅ Editable | ✅ Editable | ✅ Según reglas actuales | ✅ Según reglas actuales |
| COMPRADO | ❌ 403 | ✅ Editable + audit | ✅ Según reglas actuales | ✅ Según reglas actuales |
| ALISTAMIENTO | ❌ 403 | ✅ Editable + audit | ✅ Según reglas actuales | ✅ Según reglas actuales |
| PUBLICADO | ❌ 403 | ✅ Editable + audit | ✅ Según reglas actuales | ✅ Según reglas actuales |
| DISPONIBLE | ❌ 403 | ✅ Editable + audit | ✅ Según reglas actuales | ✅ Según reglas actuales |
| **VENDIDO** | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |

Reglas existentes (priceLocked si hay CxP, supplier inmutable, etc.) **siguen aplicando además** del nuevo lock.

## Backend

### Helper en `vehicleService`

```js
const IDENTITY_FIELDS = ['plate', 'brand', 'model', 'year', 'color', 'km'];

function assertEditPolicy(existing, changes, userRole) {
  if (existing.stage === 'VENDIDO') {
    throw new AppError('Vehículo VENDIDO: no se permiten cambios', 403);
  }
  if (existing.stage !== 'NEGOCIANDO' && userRole !== 'ADMIN') {
    const touched = Object.keys(changes).filter(f => IDENTITY_FIELDS.includes(f) && changes[f] !== existing[f]);
    if (touched.length > 0) {
      throw new AppError(`Solo un administrador puede modificar ${touched.join(', ')} una vez registrada la compra`, 403);
    }
  }
}
```

### Cambios en `vehicleService.update`

1. Leer `req.user.role` (viene del middleware).
2. Computar el diff entre `existing` y `payload`.
3. Llamar `assertEditPolicy(existing, diff, role)`.
4. Aplicar el update (las reglas actuales de `priceLocked` etc. siguen vivas — viven en el frontend, el backend hoy no las enforce; queda fuera de scope ampliarlas).
5. Escribir `VehicleAuditLog` UPDATE con before/after (solo si hubo cambios).

### Cambios en `vehicleService.delete`

- Ya bloquea VENDIDO (E.3). No cambia.
- Escribir `VehicleAuditLog` DELETE con snapshot before.

### Cambios en `vehicleService.updateStage`

- Bloqueo VENDIDO → otra etapa ya existe (E.3). No cambia.
- Escribir `VehicleAuditLog` STAGE_CHANGE con before/after del stage.

### Endpoints

- `GET /api/vehicles/:id/audit` — devuelve el log del vehículo (autenticado, sin restricción de rol).

### Controller

- `update`: extraer `req.user.role` y pasar al service.
- `restore` no aplica (no hay soft delete de vehículo).

## Frontend

### `VehicleFormModal`

- Leer `role` desde el contexto auth (necesita exponerse si todavía no).
- Calcular `identityLocked = vehicle && vehicle.stage !== 'NEGOCIANDO' && role !== 'ADMIN'`.
- Calcular `fullyLocked = vehicle && vehicle.stage === 'VENDIDO'`.
- Aplicar `disabled` + tooltip explicativo en los 6 inputs identity cuando `identityLocked`.
- Aplicar `disabled` a TODOS los inputs + ocultar el botón "Guardar Cambios" cuando `fullyLocked`. Banner top: "🔒 Vehículo VENDIDO. Solo lectura."
- Si el usuario es ADMIN y edita identity en COMPRADO+: warning amarillo "Estás editando datos de identidad de un vehículo en {etapa}. Quedará registrado en el audit log."

### `VehicleDetailPage`

- Si VENDIDO, el botón "Editar vehículo" pasa a "Ver detalle" o queda abierto pero el form en read-only (ya lo cubre el modal).
- Botón "Eliminar vehículo" ya está disabled en VENDIDO (E.4). Sin cambio.

### `AuthContext` (o donde sea)

- Exponer `currentUser.role` para que componentes lo consulten.

## Tests E2E

### Helpers nuevos
- `apiCreateUser(email, password, role)` — crea usuarios con rol específico para los tests.
- Login helper que toma rol como parámetro.

Pero esto suma fricción. Alternativa más simple:
- Helper `setUserRole(email, role)` en `tests/helpers/db.ts` que actualiza la DB directamente. Antes de cada test que necesita SUPERVISOR, hace `setUserRole('admin@autocontrol.co', 'SUPERVISOR')`. Después se restaura en cleanup.

**Decisión**: usar `setUserRole` directo en DB. Más rápido y consistente con `forceVehicleStage`.

### Specs

`tests/e2e/vehicles/edit-lock.spec.ts`:
1. **SUPERVISOR + COMPRADO**: PUT cambiando `brand` → 403.
2. **SUPERVISOR + COMPRADO**: PUT cambiando solo `notes` → 200 (no es identity).
3. **ADMIN + COMPRADO**: PUT cambiando `brand` → 200 + audit log UPDATE.
4. **ADMIN + VENDIDO**: PUT cambiando `notes` → 403.
5. **SUPERVISOR + VENDIDO**: PUT cualquier campo → 403.
6. **ADMIN + COMPRADO**: PUT genera entrada en `GET /vehicles/:id/audit` con before/after correcto.

`tests/e2e/vehicles/audit-log.spec.ts` (opcional):
- Crear vehículo, editar, cambiar stage, borrar (en NEGOCIANDO) → 4 entradas en el log.

## Plan de sprints

| # | Alcance | Tamaño |
|---|---|---|
| V.1 | Schema: enum Role + SUPERVISOR + default + VehicleAuditLog + migración | ~25 min |
| V.2 | Backend: `assertEditPolicy`, audit en update/delete/updateStage, endpoint /audit | ~40 min |
| V.3 | Frontend: VehicleFormModal con locks por rol/etapa + banner VENDIDO + AuthContext expone role | ~40 min |
| V.4 | E2E: setUserRole helper + spec edit-lock (6 tests) | ~30 min |

Total: **~2.25 h**.

## Cambios a archivos

| Archivo | Cambio |
|---|---|
| `backend/prisma/schema.prisma` | + SUPERVISOR en Role, default cambia, + VehicleAuditLog model + enum |
| `backend/prisma/migrations/*` | NUEVO |
| `backend/src/services/vehicleService.js` | `assertEditPolicy`, write audit en update/delete/updateStage, expone `getAuditLog` |
| `backend/src/controllers/vehicleController.js` | pasar `role` al update, agregar `getAuditLog` |
| `backend/src/routes/vehicles.js` | + GET /:id/audit |
| `frontend/src/contexts/AuthContext.jsx` | exponer `role` (si no lo expone) |
| `frontend/src/components/vehicles/VehicleFormModal.jsx` | locks por rol/etapa + banner VENDIDO + warning admin-edit |
| `tests/helpers/db.ts` | + `setUserRole(email, role)` |
| `tests/e2e/vehicles/edit-lock.spec.ts` | NUEVO |

## Out of scope (YAGNI)

- UI para gestionar usuarios y cambiar roles. El user toca DB directamente o vía Prisma Studio.
- Audit de cambios automáticos (auto-fill de purchaseDate al pasar a COMPRADO).
- Permisos granulares por campo (ej. ADMIN puede editar precio en VENDIDO, SUPERVISOR no). Hoy es binario: VENDIDO = locked para todos.
- Escape hatch para sacar un vehículo de VENDIDO (anular venta). Si surge, es feature aparte.
- Vista de audit log en la UI. Por ahora solo expuesto vía API.
