# Gestión de usuarios (admin-only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el registro público inseguro y dar al ADMIN una gestión de usuarios completa (crear con rol, listar, activar/desactivar, cambiar rol, resetear contraseña/PIN, borrar) con una sección en Configuración, con salvaguardas (último ADMIN, auto-acción, borrado seguro).

**Architecture:** Endpoints REST `/users` detrás de `authenticate` + `authorize('ADMIN')`, con `userService.js` (lógica + salvaguardas, hash bcryptjs). Se elimina `POST /auth/register`. Frontend: `usersApi` + un componente `UsersSection` montado en `SettingsPage` solo para ADMIN. Sin cambios de schema (no hay migración). Cobertura conductual por E2E Playwright.

**Tech Stack:** Node.js + Express + Prisma (CommonJS), bcryptjs, Joi; React 18 + Vite + Tailwind; Playwright.

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/src/middleware/validation.js` | Modificar | Schemas `userCreate`/`userRole`/`userStatus`/`userPassword`; quitar `register` |
| `backend/src/services/userService.js` | Crear | list/create/updateRole/setStatus/resetCredentials/remove + salvaguardas |
| `backend/src/controllers/userController.js` | Crear | Controladores delgados |
| `backend/src/routes/users.js` | Crear | Rutas REST (todo el router con `authorize('ADMIN')`) |
| `backend/src/routes/index.js` | Modificar | Montar `/users` |
| `backend/src/routes/auth.js` | Modificar | Quitar `POST /register` |
| `backend/src/controllers/authController.js` | Modificar | Quitar `register` |
| `backend/src/services/authService.js` | Modificar | Quitar `register` |
| `frontend/src/lib/usersApi.js` | Crear | Cliente API de usuarios |
| `frontend/src/components/settings/UsersSection.jsx` | Crear | UI de gestión (tabla + modales) |
| `frontend/src/pages/SettingsPage.jsx` | Modificar | Renderizar `UsersSection` solo si ADMIN |
| `tests/helpers/api.ts` | Modificar | Helpers e2e de usuarios |
| `tests/e2e/auth/user-management.spec.ts` | Crear | E2E del feature |

---

## Task 1: Validación Joi de usuarios

**Files:**
- Modify: `backend/src/middleware/validation.js`

- [ ] **Step 1: Agregar los schemas de usuario**

En `backend/src/middleware/validation.js`, antes del bloque `module.exports = {` (línea ~487), agregar:

```js
// ── User Management Schemas (admin-only) ──
const USER_ROLES = ['ADMIN', 'SUPERVISOR', 'VIEWER'];

const userCreateSchema = Joi.object({
  email: Joi.string().email().required().messages({ 'any.required': 'Email es requerido' }),
  password: Joi.string().min(8).required().messages({ 'string.min': 'La contraseña debe tener al menos 8 caracteres' }),
  name: Joi.string().max(100).allow('', null),
  role: Joi.string().valid(...USER_ROLES).required(),
  pin: Joi.string().pattern(/^\d{4,6}$/).allow(null).messages({ 'string.pattern.base': 'El PIN debe ser 4 a 6 dígitos' }),
});

const userRoleSchema = Joi.object({
  role: Joi.string().valid(...USER_ROLES).required(),
});

const userStatusSchema = Joi.object({
  isActive: Joi.boolean().required(),
});

const userPasswordSchema = Joi.object({
  password: Joi.string().min(8),
  pin: Joi.string().pattern(/^\d{4,6}$/),
}).or('password', 'pin').messages({ 'object.missing': 'Debe enviar al menos password o pin' });
```

- [ ] **Step 2: Registrar en el mapa `schemas`**

En el objeto `schemas` (dentro de `module.exports`), después de la línea `commissionConfig: commissionConfigSchema,`, agregar:

```js
    // Users
    userCreate: userCreateSchema,
    userRole: userRoleSchema,
    userStatus: userStatusSchema,
    userPassword: userPasswordSchema,
```

- [ ] **Step 3: Verificar carga**

Run: `cd backend && node -e "const {schemas}=require('./src/middleware/validation'); console.log(!!schemas.userCreate,!!schemas.userRole,!!schemas.userStatus,!!schemas.userPassword)"`
Expected: `true true true true`

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/validation.js
git commit -m "feat(auth): schemas de validación para gestión de usuarios"
```

---

## Task 2: `userService.js`

**Files:**
- Create: `backend/src/services/userService.js`

- [ ] **Step 1: Crear el servicio**

Crear `backend/src/services/userService.js`:

```js
// ═══════════════════════════════════════════════════════════════
// Service — User Management (admin-only)
// ═══════════════════════════════════════════════════════════════

const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

// Campos seguros: NUNCA exponer password ni pin.
const SAFE_SELECT = {
  id: true, email: true, name: true, role: true,
  isActive: true, lastLogin: true, createdAt: true,
};

async function getTargetOr404(id) {
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new AppError('Usuario no encontrado', 404);
  return target;
}

// Lanza si el target es el único ADMIN activo (para degradar/desactivar/borrar).
async function assertNotLastActiveAdmin(target) {
  if (target.role === 'ADMIN' && target.isActive) {
    const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
    if (activeAdmins <= 1) {
      throw new AppError('Debe quedar al menos un ADMIN activo', 403);
    }
  }
}

class UserService {
  async list() {
    return prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: SAFE_SELECT });
  }

  async create({ email, password, name, role, pin }) {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new AppError('El email ya está registrado', 409);
    return prisma.user.create({
      data: {
        email,
        name: name || null,
        role,
        password: await bcrypt.hash(password, 12),
        pin: pin ? await bcrypt.hash(pin, 10) : null,
      },
      select: SAFE_SELECT,
    });
  }

  async updateRole(id, role, actorId) {
    if (id === actorId) throw new AppError('No podés cambiar tu propio rol', 403);
    const target = await getTargetOr404(id);
    if (role !== 'ADMIN') await assertNotLastActiveAdmin(target); // degradar al último ADMIN
    return prisma.user.update({ where: { id }, data: { role }, select: SAFE_SELECT });
  }

  async setStatus(id, isActive, actorId) {
    if (id === actorId) throw new AppError('No podés cambiar tu propio estado', 403);
    const target = await getTargetOr404(id);
    if (isActive === false) await assertNotLastActiveAdmin(target); // desactivar al último ADMIN
    return prisma.user.update({ where: { id }, data: { isActive }, select: SAFE_SELECT });
  }

  async resetCredentials(id, { password, pin }) {
    await getTargetOr404(id);
    const data = {};
    if (password) data.password = await bcrypt.hash(password, 12);
    if (pin) data.pin = await bcrypt.hash(pin, 10);
    if (Object.keys(data).length === 0) throw new AppError('Debe enviar al menos password o pin', 400);
    return prisma.user.update({ where: { id }, data, select: SAFE_SELECT });
  }

  async remove(id, actorId) {
    if (id === actorId) throw new AppError('No podés borrar tu propio usuario', 403);
    const target = await getTargetOr404(id);
    await assertNotLastActiveAdmin(target);

    // Integridad/auditoría: bloquear borrado si tiene datos asociados.
    // FKs Restrict sobre User: vehicles + los 3 audit logs. createdBy es string (no FK)
    // pero se incluye para preservar trazabilidad.
    const [vehicles, txs, eAudit, vAudit, tAudit] = await Promise.all([
      prisma.vehicle.count({ where: { userId: id } }),
      prisma.transaction.count({ where: { createdBy: id } }),
      prisma.expenseAuditLog.count({ where: { userId: id } }),
      prisma.vehicleAuditLog.count({ where: { userId: id } }),
      prisma.treasuryAuditLog.count({ where: { userId: id } }),
    ]);
    if (vehicles + txs + eAudit + vAudit + tAudit > 0) {
      throw new AppError('El usuario tiene datos asociados; desactivalo en lugar de borrarlo', 409);
    }

    await prisma.user.delete({ where: { id } }); // refresh_tokens cascadean
    return { deleted: true };
  }
}

module.exports = new UserService();
module.exports.SAFE_SELECT = SAFE_SELECT;
```

- [ ] **Step 2: Verificar carga**

Run: `cd backend && node -e "const s=require('./src/services/userService'); console.log(['list','create','updateRole','setStatus','resetCredentials','remove'].map(m=>typeof s[m]).join(' '))"`
Expected: `function function function function function function`

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/userService.js
git commit -m "feat(auth): userService con gestión de usuarios y salvaguardas"
```

---

## Task 3: Controller + rutas + montaje

**Files:**
- Create: `backend/src/controllers/userController.js`
- Create: `backend/src/routes/users.js`
- Modify: `backend/src/routes/index.js`

- [ ] **Step 1: Crear el controller**

Crear `backend/src/controllers/userController.js`:

```js
const userService = require('../services/userService');

const list = async (req, res, next) => {
  try { res.json(await userService.list()); } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try { res.status(201).json(await userService.create(req.body)); } catch (err) { next(err); }
};

const updateRole = async (req, res, next) => {
  try { res.json(await userService.updateRole(req.params.id, req.body.role, req.user.id)); } catch (err) { next(err); }
};

const setStatus = async (req, res, next) => {
  try { res.json(await userService.setStatus(req.params.id, req.body.isActive, req.user.id)); } catch (err) { next(err); }
};

const resetCredentials = async (req, res, next) => {
  try { res.json(await userService.resetCredentials(req.params.id, req.body)); } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try { res.json(await userService.remove(req.params.id, req.user.id)); } catch (err) { next(err); }
};

module.exports = { list, create, updateRole, setStatus, resetCredentials, remove };
```

- [ ] **Step 2: Crear las rutas**

Crear `backend/src/routes/users.js`:

```js
const express = require('express');
const ctrl = require('../controllers/userController');
const { authorize } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

// Todo el módulo es exclusivo de ADMIN (authenticate ya se aplicó globalmente).
router.use(authorize('ADMIN'));

router.get('/', ctrl.list);
router.post('/', validate(schemas.userCreate), ctrl.create);
router.patch('/:id/role', validate(schemas.userRole), ctrl.updateRole);
router.patch('/:id/status', validate(schemas.userStatus), ctrl.setStatus);
router.patch('/:id/password', validate(schemas.userPassword), ctrl.resetCredentials);
router.delete('/:id', ctrl.remove);

module.exports = router;
```

- [ ] **Step 3: Montar en el router principal**

En `backend/src/routes/index.js`, después de la línea `router.use('/debts', require('./debts'));`, agregar:

```js
router.use('/users', require('./users'));
```

- [ ] **Step 4: Verificar carga**

Run: `cd backend && node -e "require('./src/routes/index')"`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/userController.js backend/src/routes/users.js backend/src/routes/index.js
git commit -m "feat(auth): endpoints REST de gestión de usuarios (admin-only)"
```

---

## Task 4: Cerrar el registro público

**Files:**
- Modify: `backend/src/routes/auth.js:12`
- Modify: `backend/src/controllers/authController.js`
- Modify: `backend/src/services/authService.js`
- Modify: `backend/src/middleware/validation.js`

- [ ] **Step 1: Quitar la ruta de registro**

En `backend/src/routes/auth.js`, eliminar la línea:

```js
router.post('/register', validate(schemas.register), ctrl.register);
```

- [ ] **Step 2: Quitar `register` del controller**

En `backend/src/controllers/authController.js`, eliminar el bloque completo de la función `register` (líneas 7-12) y quitar `register` del `module.exports` (debe quedar `module.exports = { login, pinLogin, refreshToken, changePassword, logout, me };`).

- [ ] **Step 3: Quitar `register` del service**

En `backend/src/services/authService.js`, eliminar el método `async register({ email, password, name, pin }) { ... }` completo (la creación de usuarios ahora vive en `userService.create`).

- [ ] **Step 4: Quitar el schema `register`**

En `backend/src/middleware/validation.js`:
- Eliminar el `const registerSchema = Joi.object({ ... });` (el bloque de `registerSchema`).
- Eliminar la línea `register: registerSchema,` del objeto `schemas`.

- [ ] **Step 5: Verificar que no quedan referencias y que carga**

Run: `cd backend && grep -rn "schemas.register\b\|authService.register\|ctrl.register\b" src && echo "QUEDAN REFERENCIAS" || echo "sin referencias"`
Expected: `sin referencias`

Run: `cd backend && node -e "require('./src/routes/index'); require('./src/services/authService'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth.js backend/src/controllers/authController.js backend/src/services/authService.js backend/src/middleware/validation.js
git commit -m "feat(auth): cerrar el registro público (creación de usuarios solo admin)"
```

---

## Task 5: Frontend — `usersApi` + sección Usuarios en Config

**Files:**
- Create: `frontend/src/lib/usersApi.js`
- Create: `frontend/src/components/settings/UsersSection.jsx`
- Modify: `frontend/src/pages/SettingsPage.jsx`

- [ ] **Step 1: Crear `usersApi`**

Crear `frontend/src/lib/usersApi.js`:

```js
import api from '@/lib/api';

export const usersApi = {
  getAll: () => api.get('/users'),
  create: (data) => api.post('/users', data),
  updateRole: (id, role) => api.patch(`/users/${id}/role`, { role }),
  setStatus: (id, isActive) => api.patch(`/users/${id}/status`, { isActive }),
  resetCredentials: (id, data) => api.patch(`/users/${id}/password`, data),
  remove: (id) => api.delete(`/users/${id}`),
};
```

- [ ] **Step 2: Crear el componente `UsersSection`**

Crear `frontend/src/components/settings/UsersSection.jsx`:

```jsx
import { useEffect, useState } from 'react';
import Modal from '@/components/shared/Modal';
import { Input } from '@/components/shared/FormFields';
import { usersApi } from '@/lib/usersApi';

const ROLES = ['ADMIN', 'SUPERVISOR', 'VIEWER'];

export default function UsersSection() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [resetting, setResetting] = useState(null);

  const reload = () => usersApi.getAll().then((r) => setUsers(r.data)).catch(() => {});
  useEffect(() => { reload(); }, []);

  const act = async (fn) => {
    setError('');
    try { await fn(); await reload(); }
    catch (e) { setError(e.response?.data?.error || 'Error en la operación'); }
  };

  return (
    <div className="card" data-testid="settings-users-card">
      <div className="flex items-center justify-between">
        <div className="card-title">Usuarios</div>
        <button className="btn-primary" onClick={() => setShowNew(true)} data-testid="users-new-button">+ Nuevo usuario</button>
      </div>

      {error && <p className="text-xs text-[#F85149] mt-2" data-testid="users-error">{error}</p>}

      <table className="w-full text-sm mt-4">
        <thead className="text-[#8B949E] text-xs">
          <tr><th className="text-left py-1">Email</th><th className="text-left">Nombre</th><th className="text-left">Rol</th><th className="text-left">Estado</th><th className="text-right">Acciones</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-border" data-testid={`users-row-${u.id}`}>
              <td className="py-2">{u.email}</td>
              <td>{u.name || '—'}</td>
              <td>
                <select
                  className="input text-sm"
                  value={u.role}
                  onChange={(e) => act(() => usersApi.updateRole(u.id, e.target.value))}
                  data-testid={`users-role-${u.id}`}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td>{u.isActive ? <span className="text-green-400">Activo</span> : <span className="text-[#6E7681]">Inactivo</span>}</td>
              <td className="text-right space-x-2">
                <button className="btn-ghost text-xs" onClick={() => act(() => usersApi.setStatus(u.id, !u.isActive))} data-testid={`users-status-${u.id}`}>
                  {u.isActive ? 'Desactivar' : 'Activar'}
                </button>
                <button className="btn-ghost text-xs" onClick={() => setResetting(u)} data-testid={`users-reset-${u.id}`}>Resetear</button>
                <button
                  className="btn-ghost text-xs text-[#F85149]"
                  onClick={() => { if (window.confirm(`¿Eliminar a ${u.email}?`)) act(() => usersApi.remove(u.id)); }}
                  data-testid={`users-delete-${u.id}`}
                >Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showNew && <NewUserModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); reload(); }} onError={setError} />}
      {resetting && <ResetModal user={resetting} onClose={() => setResetting(null)} onError={setError} />}
    </div>
  );
}

function NewUserModal({ onClose, onDone, onError }) {
  const [form, setForm] = useState({ email: '', name: '', password: '', pin: '', role: 'VIEWER' });
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try {
      await usersApi.create({
        email: form.email, name: form.name || null, password: form.password,
        role: form.role, pin: form.pin || null,
      });
      onDone();
    } catch (e) { onError(e.response?.data?.error || 'Error al crear usuario'); onClose(); }
    finally { setLoading(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Nuevo usuario">
      <div className="space-y-4">
        <Input label="Email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        <Input label="Nombre" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input label="Contraseña" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        <Input label="PIN (4-6 dígitos, opcional)" value={form.pin} onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))} />
        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Rol</label>
          <select className="input w-full" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} data-testid="users-new-role">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex gap-2 pt-2">
          <button className="btn-ghost flex-1" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading} data-testid="users-new-submit">{loading ? 'Creando...' : 'Crear'}</button>
        </div>
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose, onError }) {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try {
      const data = {};
      if (password) data.password = password;
      if (pin) data.pin = pin;
      await usersApi.resetCredentials(user.id, data);
      onClose();
    } catch (e) { onError(e.response?.data?.error || 'Error al resetear'); onClose(); }
    finally { setLoading(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`Resetear credenciales: ${user.email}`}>
      <div className="space-y-4">
        <Input label="Nueva contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input label="Nuevo PIN (4-6 dígitos)" value={pin} onChange={(e) => setPin(e.target.value)} />
        <p className="text-xs text-[#6E7681]">Completá al menos uno.</p>
        <div className="flex gap-2 pt-2">
          <button className="btn-ghost flex-1" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading || (!password && !pin)} data-testid="users-reset-submit">{loading ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Montar en `SettingsPage` (solo ADMIN)**

En `frontend/src/pages/SettingsPage.jsx`:
- En el import de auth (línea 3 `import { useAuth } from '@/contexts/AuthContext';`) ya existe. Cambiar la desestructuración de la línea 9 para incluir `role`:

```jsx
  const { changePassword, role } = useAuth();
```

- Agregar el import del componente tras la línea 5 (`import api from '@/lib/api';`):

```jsx
import UsersSection from '@/components/settings/UsersSection';
```

- Renderizar la sección antes del cierre del contenedor (justo después del `</div>` de la card "Cambiar Contraseña", antes del `</div>` final que cierra el return — línea 116/117):

```jsx
      {role === 'ADMIN' && <UsersSection />}
```

- [ ] **Step 4: Verificar build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/usersApi.js frontend/src/components/settings/UsersSection.jsx frontend/src/pages/SettingsPage.jsx
git commit -m "feat(auth): sección de gestión de usuarios en Config (admin-only)"
```

---

## Task 6: E2E — gestión de usuarios

**Files:**
- Modify: `tests/helpers/api.ts`
- Create: `tests/e2e/auth/user-management.spec.ts`
- Reference: `tests/fixtures/auth.ts` (`loginAsAdmin`), `tests/helpers/api.ts` (`apiRequestRaw`), `tests/helpers/db.ts` (`setUserRole`)

- [ ] **Step 1: Agregar helpers de API**

En `tests/helpers/api.ts`, agregar al final:

```ts
export interface ManagedUser {
  id: string;
  email: string;
  name: string | null;
  role: 'ADMIN' | 'SUPERVISOR' | 'VIEWER';
  isActive: boolean;
}

export async function apiCreateUser(
  token: string,
  data: { email: string; password: string; name?: string | null; role: string; pin?: string | null },
): Promise<ManagedUser> {
  return postJson('/users', data, token);
}

export async function apiMe(token: string): Promise<{ user: { id: string; email: string; role: string } }> {
  return getJson('/auth/me', token);
}
```

> Antes de escribir, confirmá en `tests/helpers/api.ts` los nombres reales de `postJson`/`getJson` y reusalos. `apiRequestRaw(method, path, token, body?)` ya existe y devuelve `{ status, body }`; para llamadas sin token pasá `''`.

- [ ] **Step 2: Crear el spec E2E**

Crear `tests/e2e/auth/user-management.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiRequestRaw, apiCreateUser, apiMe } from '../../helpers/api';
import { setUserRole } from '../../helpers/db';

const ADMIN_EMAIL = 'admin@autocontrol.co';
const uniq = () => `u${Date.now().toString().slice(-7)}@test.co`;

test.describe('Gestión de usuarios (admin-only)', () => {
  test.afterEach(async () => { await setUserRole(ADMIN_EMAIL, 'ADMIN'); });

  test('ADMIN crea un VIEWER: puede leer, no escribir; reset y login', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const email = uniq();

    const created = await apiCreateUser(token, { email, password: 'Pass12345', role: 'VIEWER', pin: '123456' });
    expect(created.role).toBe('VIEWER');
    expect(created.isActive).toBe(true);

    // login del nuevo usuario y permisos
    expect((await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Pass12345' })).status).toBe(200);
    const vToken = (await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Pass12345' })).body.accessToken as string;
    expect((await apiRequestRaw('GET', '/vehicles', vToken)).status).toBe(200);
    expect((await apiRequestRaw('POST', '/vehicles', vToken, { plate: 'NOPE01' })).status).toBe(403);

    // reset de contraseña: nueva sí, vieja no
    expect((await apiRequestRaw('PATCH', `/users/${created.id}/password`, token, { password: 'Nueva99999' })).status).toBe(200);
    expect((await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Nueva99999' })).status).toBe(200);
    expect((await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Pass12345' })).status).toBe(401);

    // desactivar → no puede loguear
    expect((await apiRequestRaw('PATCH', `/users/${created.id}/status`, token, { isActive: false })).status).toBe(200);
    expect((await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Nueva99999' })).status).toBe(401);

    // borrar usuario sin actividad → ok
    expect((await apiRequestRaw('DELETE', `/users/${created.id}`, token)).status).toBe(200);
  });

  test('no-ADMIN no puede acceder a /users (403)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    await setUserRole(ADMIN_EMAIL, 'SUPERVISOR'); // authenticate re-lee el rol de la DB por request
    expect((await apiRequestRaw('GET', '/users', token)).status).toBe(403);
    expect((await apiRequestRaw('POST', '/users', token, { email: uniq(), password: 'Pass12345', role: 'VIEWER' })).status).toBe(403);
  });

  test('salvaguardas: auto-acción y último ADMIN bloqueados', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const me = (await apiMe(token)).user;

    // auto-acción: cambiarme el rol / desactivarme → 403
    expect((await apiRequestRaw('PATCH', `/users/${me.id}/role`, token, { role: 'VIEWER' })).status).toBe(403);
    expect((await apiRequestRaw('PATCH', `/users/${me.id}/status`, token, { isActive: false })).status).toBe(403);
    expect((await apiRequestRaw('DELETE', `/users/${me.id}`, token)).status).toBe(403);
  });

  test('borrar un usuario CON actividad → 409 (sugiere desactivar)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const email = uniq();
    const sup = await apiCreateUser(token, { email, password: 'Pass12345', role: 'SUPERVISOR' });

    // El SUPERVISOR crea un vehículo (genera actividad/datos asociados)
    const supToken = (await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Pass12345' })).body.accessToken as string;
    expect((await apiRequestRaw('POST', '/vehicles', supToken, { plate: `ACT${Date.now().toString().slice(-6)}` })).status).toBe(201);

    // Borrarlo ahora debe bloquearse con 409
    const del = await apiRequestRaw('DELETE', `/users/${sup.id}`, token);
    expect(del.status).toBe(409);

    // Desactivarlo sí funciona (alternativa segura)
    expect((await apiRequestRaw('PATCH', `/users/${sup.id}/status`, token, { isActive: false })).status).toBe(200);
  });

  test('el registro público quedó cerrado (404)', async ({ page }) => {
    await loginAsAdmin(page);
    expect((await apiRequestRaw('POST', '/auth/register', '', { email: uniq(), password: 'Pass12345' })).status).toBe(404);
  });
});
```

> Notas: el admin de prueba es el único ADMIN, así que la auto-acción y el "último ADMIN" se solapan — la salvaguarda de auto-acción responde primero con 403, que es lo aserido. `accessToken` es el nombre del campo del token en la respuesta de login; confirmar contra `authService` (`_generateTokens`) y ajustar si difiere.

- [ ] **Step 3: Correr el spec nuevo**

Run: `npx playwright test tests/e2e/auth/user-management.spec.ts`
Expected: 5 passed.

- [ ] **Step 4: Regresión de auth/viewer**

Run: `npx playwright test tests/e2e/auth/`
Expected: todo verde (el viewer-readonly sigue pasando).

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/api.ts tests/e2e/auth/user-management.spec.ts
git commit -m "test(auth): e2e de gestión de usuarios + registro cerrado"
```

---

## Verificación final

- [ ] **Unit:** `cd backend && node --test src/` → verde.
- [ ] **Build frontend:** `cd frontend && npm run build` → ok.
- [ ] **E2E:** `npx playwright test tests/e2e/auth/` → verde.
- [ ] Invocar `verification-loop` (build + lint + tests + security) antes de marcar completo.
