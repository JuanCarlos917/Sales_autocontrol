# Spec: Gestión de usuarios (admin-only) + cierre del registro público

- **Fecha:** 2026-06-14
- **Estado:** Aprobado (diseño)
- **Módulo:** Auth / Configuración → Usuarios

## Problema

`POST /auth/register` está **abierto al público** (sin autenticación) y crea usuarios
con rol **SUPERVISOR** por defecto (con permisos de escritura). Cualquiera en internet
podría auto-registrar una cuenta que modifica datos en producción — un hueco de
seguridad real. Además, no existe forma de gestionar usuarios (crear con un rol
específico, cambiar rol, revocar acceso, resetear credenciales) salvo tocar la DB a mano.

Se necesita: **cerrar el registro público** y exponer **gestión de usuarios solo para
ADMIN**, con una pantalla en Configuración.

## Decisiones de diseño (confirmadas)

| Decisión | Resolución |
|---|---|
| Acciones del ADMIN | Crear, listar, activar/desactivar, cambiar rol, **resetear contraseña/PIN**, **eliminar** |
| Registro público | **Quitarlo** y reemplazar por `POST /users` admin-only |
| Ubicación UI | **Sección dentro de Config** (`SettingsPage`), visible solo para ADMIN |
| Salvaguardas | Proteger último ADMIN activo + bloquear auto-acción + borrado seguro por integridad |

## Contexto del código (relevante)

- Roles: `enum Role { ADMIN SUPERVISOR VIEWER }`. `User.role` default actual = `SUPERVISOR`.
- `authenticate` + `authorize('ADMIN')` + `blockViewerWrites` ya existen en `middleware/auth.js`.
- `login` ya rechaza `isActive: false` (401); `pinLogin` solo busca activos → **desactivar
  revoca acceso al instante**.
- Hash: **bcryptjs** (password cost 12, pin cost 10), igual que `authService`/`seed.js`.
- `authService.register` solo lo usa `authController.register` (seed.js usa Prisma directo).
- Frontend: `SettingsPage` usa `useAuth` (de `@/contexts/AuthContext`) y se organiza en
  "cards". `useAuth` expone `role`. Ningún componente del frontend usa `/auth/register`.

## Restricciones

- Backend CommonJS; validación con Joi; idioma UI español, código en inglés.
- Preservar trazabilidad: no romper los `createdBy` de movimientos al borrar usuarios.

---

## 1. Backend — endpoints (`routes/users.js`, montado en `/users`)

Todos detrás de `authenticate` + `authorize('ADMIN')`:

| Método | Ruta | Acción |
|---|---|---|
| GET | `/users` | Listar usuarios |
| POST | `/users` | Crear usuario `{ email, password, name?, role, pin? }` |
| PATCH | `/users/:id/role` | Cambiar rol `{ role }` |
| PATCH | `/users/:id/status` | Activar/desactivar `{ isActive }` |
| PATCH | `/users/:id/password` | Resetear `{ password?, pin? }` (al menos uno) |
| DELETE | `/users/:id` | Eliminar usuario |

Respuestas de lista/usuario exponen solo campos seguros:
`id, email, name, role, isActive, lastLogin, createdAt` (nunca `password`/`pin`).

Montaje en `routes/index.js`: `router.use('/users', require('./users'))` (después de
`authenticate`/`blockViewerWrites`).

## 2. Backend — `userService.js`

```
list()                              → usuarios (campos seguros), orden por createdAt desc
create({ email, password, name, role, pin })
updateRole(id, role, actorId)
setStatus(id, isActive, actorId)
resetCredentials(id, { password, pin })
remove(id, actorId)
```

- **create:** email único (409 si existe); `role` ∈ enum; hashea password (12) y pin (10).
- **updateRole / setStatus / remove — salvaguardas** (lanzan `AppError`):
  - **Auto-acción:** `actorId === id` → 403 ("no podés cambiar tu propio rol / desactivarte /
    borrarte").
  - **Último ADMIN:** si el target es ADMIN y la acción lo degrada / desactiva / borra, y la
    cantidad de **ADMIN activos** es 1 → 403 ("debe quedar al menos un ADMIN activo").
- **resetCredentials:** exige al menos `password` o `pin`; hashea lo provisto. Permitida
  sobre cualquier usuario (incluido uno mismo).
- **remove — integridad/auditoría:** si el usuario tiene **datos asociados** (vehículos
  propios `Vehicle.userId`, o movimientos/registros creados por él) → **409** con mensaje
  "tiene datos asociados; desactivalo en lugar de borrarlo". El borrado real solo procede
  para usuarios sin actividad (ej. creado por error). Chequear al menos: vehículos
  (`vehicle.count({ where: { userId: id } })`) y transacciones
  (`transaction.count({ where: { createdBy: id } })`).

## 3. Backend — cerrar el registro público

- Eliminar la ruta `POST /auth/register` de `routes/auth.js`.
- Eliminar `register` de `authController` (y de su `module.exports`).
- Eliminar `authService.register` (la lógica de creación vive en `userService.create`).
- Mantener `login`, `pinLogin`, `refreshToken`, `changePassword`, `logout`, `me` sin cambios.

## 4. Backend — validación (`validation.js`)

```js
const ROLES = ['ADMIN', 'SUPERVISOR', 'VIEWER'];

userCreateSchema   = { email: email().required(), password: string().min(8).required(),
                       name: string().max(100).allow('', null),
                       role: string().valid(...ROLES).required(),
                       pin: string().pattern(/^\d{4,6}$/).allow(null) }
userRoleSchema     = { role: string().valid(...ROLES).required() }
userStatusSchema   = { isActive: boolean().required() }
userPasswordSchema = { password: string().min(8), pin: string().pattern(/^\d{4,6}$/) }
                     .or('password', 'pin')   // al menos uno
```

Registrar en el mapa `schemas` exportado.

## 5. Frontend — sección "Usuarios" en `SettingsPage`

- `usersApi` (en `lib/`): `getAll`, `create`, `updateRole`, `setStatus`, `resetCredentials`,
  `remove`.
- **Card "Usuarios"**, renderizada **solo si `role === 'ADMIN'`**:
  - Tabla: email, nombre, **rol** (selector por fila → `updateRole`), **estado**
    (toggle activar/desactivar → `setStatus`), acciones: **Resetear** (modal con nueva
    password y/o PIN), **Eliminar** (con confirmación).
  - Botón **"Nuevo usuario"** → modal: email, nombre, password, PIN, selector de rol →
    `create`.
  - Los errores del backend (último ADMIN, auto-acción, datos asociados, email duplicado)
    se muestran en la UI con su mensaje.
- El admin define la contraseña inicial al crear. (No hay "olvidé mi contraseña" self-service:
  el reset lo hace un ADMIN.)

## 6. Estrategia de pruebas (E2E Playwright)

Patrón existente: `tests/e2e/auth/viewer-readonly.spec.ts` baja el rol del admin de prueba
a VIEWER vía `setUserRole` (helper de DB). Para este feature usar el endpoint real.

- ADMIN crea un usuario VIEWER (`POST /users`) → ese usuario puede `GET` (200) pero sus
  escrituras dan 403.
- ADMIN **desactiva** al usuario (`PATCH /status`) → ese usuario no puede loguear (401).
- ADMIN **resetea** la contraseña (`PATCH /password`) → login con la nueva funciona, con la
  vieja no.
- **No-ADMIN** (SUPERVISOR/VIEWER) → cualquier `/users` responde **403**.
- **Salvaguardas:** degradar/desactivar/borrar al último ADMIN → 403; auto-acción → 403.
- **Borrado:** usuario sin actividad → 200; usuario con vehículos/movimientos → 409.
- **Registro cerrado:** `POST /auth/register` → **404**.

**Cobertura objetivo:** ≥ 80%.

## Fuera de alcance (YAGNI)

- Auto-registro / invitaciones por email / verificación de email.
- "Olvidé mi contraseña" self-service (el reset es vía ADMIN).
- 2FA / SSO.
- Auditoría dedicada de acciones sobre usuarios (se puede agregar luego si se requiere).
