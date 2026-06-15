# UX y sesión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar `/settings` en pestañas, quitar la pista de credenciales del login, agregar cierre de sesión por inactividad (1 h, aviso 1 min antes) en todos los roles, y ocultar todos los controles de escritura para el rol VIEWER; más un e2e que documenta que sesiones de usuarios distintos son independientes.

**Architecture:** Cambios solo en frontend (sin schema ni endpoints nuevos). Se expone `isViewer` desde `AuthContext`; un hook `useIdleTimeout` + `IdleWarningModal` se integran en `AppLayout` (envoltura autenticada). `SettingsPage` pasa a un layout con tabs. La cobertura es por E2E Playwright (no hay runner unit en el frontend); el hook de inactividad se prueba con umbrales reducidos vía override de dev.

**Tech Stack:** React 18 + Vite + Tailwind; Playwright. Sin migración de DB.

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `frontend/src/contexts/AuthContext.jsx` | Modificar | Exponer `isViewer` |
| `frontend/src/pages/LoginPage.jsx` | Modificar | Quitar pista de credenciales |
| `frontend/src/pages/SettingsPage.jsx` | Reescribir | Layout con pestañas |
| `frontend/src/hooks/useIdleTimeout.js` | Crear | Lógica de inactividad |
| `frontend/src/components/auth/IdleWarningModal.jsx` | Crear | Aviso antes de cerrar sesión |
| `frontend/src/components/layout/AppLayout.jsx` | Modificar | Integrar idle timeout |
| `frontend/src/pages/ExpensesPage.jsx` | Modificar | Ocultar controles de escritura a VIEWER |
| `frontend/src/pages/treasury/LoansPage.jsx` | Modificar | Idem |
| `frontend/src/pages/treasury/DebtsPage.jsx` | Modificar | Idem |
| `frontend/src/pages/treasury/AccountsPage.jsx` | Modificar | Idem |
| `frontend/src/pages/treasury/PayablesPage.jsx` | Modificar | Idem |
| `tests/e2e/ux/ux-session.spec.ts` | Crear | E2E de todo el feature |

---

## Task 1: Exponer `isViewer` desde `AuthContext`

**Files:**
- Modify: `frontend/src/contexts/AuthContext.jsx:61`

- [ ] **Step 1: Agregar `isViewer` al value del provider**

Reemplazar la línea del `AuthContext.Provider value=...` (línea 61):

```jsx
    <AuthContext.Provider value={{ user, role: user?.role ?? null, isViewer: user?.role === 'VIEWER', loading, login, pinLogin, logout, changePassword, isAuthenticated: !!user }}>
```

- [ ] **Step 2: Verificar build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/contexts/AuthContext.jsx
git commit -m "feat(auth): exponer isViewer desde AuthContext"
```

---

## Task 2: Quitar la pista de credenciales del login

**Files:**
- Modify: `frontend/src/pages/LoginPage.jsx`

- [ ] **Step 1: Eliminar la línea de la pista**

En `frontend/src/pages/LoginPage.jsx`, eliminar por completo la línea:

```jsx
        <p className="text-[10px] text-[#6E7681] mt-6">PIN por defecto: 1234 · Email: admin@autocontrol.co</p>
```

- [ ] **Step 2: Neutralizar el placeholder del email**

En el mismo archivo, en el `<input type="email" ... placeholder="admin@autocontrol.co" ...>`, cambiar el placeholder a genérico:

```jsx
placeholder="tu@email.com"
```

- [ ] **Step 3: Verificar build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LoginPage.jsx
git commit -m "fix(login): quitar pista de credenciales por defecto"
```

---

## Task 3: Settings con pestañas

**Files:**
- Modify (rewrite): `frontend/src/pages/SettingsPage.jsx`

- [ ] **Step 1: Reescribir `SettingsPage` con tabs**

Reemplazar el contenido completo de `frontend/src/pages/SettingsPage.jsx` por:

```jsx
import { useEffect, useState, useMemo } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/shared/FormFields';
import api from '@/lib/api';
import UsersSection from '@/components/settings/UsersSection';

export default function SettingsPage() {
  const { fetchSettings, updateSettings } = useApp();
  const { changePassword, role } = useAuth();
  const [settings, setSettings] = useState({ fixedMonthly: '800000', alertDays: '15' });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [commCfg, setCommCfg] = useState(null);
  const [commError, setCommError] = useState('');
  const [commSuccess, setCommSuccess] = useState(false);
  const [tab, setTab] = useState('negocio');

  useEffect(() => {
    fetchSettings().then(s => { if (s) setSettings({ fixedMonthly: s.fixedMonthly || '800000', alertDays: s.alertDays || '15' }); });
  }, [fetchSettings]);

  useEffect(() => {
    api.get('/settings/commission-config').then(r => setCommCfg(r.data)).catch(() => {});
  }, []);

  const tabs = useMemo(() => {
    const base = [
      { id: 'negocio', label: 'Negocio' },
      { id: 'comisiones', label: 'Comisiones' },
      { id: 'cuenta', label: 'Cuenta' },
    ];
    if (role === 'ADMIN') base.push({ id: 'usuarios', label: 'Usuarios' });
    return base;
  }, [role]);

  const handleSaveSettings = () => { updateSettings(settings); };

  const handleSaveCommissions = async () => {
    setCommError(''); setCommSuccess(false);
    const bucketSum = Number(commCfg.commission_share_pct) + Number(commCfg.reinvest_share_pct) + Number(commCfg.tax_share_pct);
    if (Math.abs(bucketSum - 100) > 0.001) { setCommError('Los tres bolsillos deben sumar 100'); return; }
    const splitSum = Number(commCfg.default_captador_pct) + Number(commCfg.default_cerrador_pct);
    if (Math.abs(splitSum - 100) > 0.001) { setCommError('Captador + cerrador deben sumar 100'); return; }
    try {
      await api.put('/settings/commission-config', commCfg);
      setCommSuccess(true);
    } catch (err) {
      setCommError(err.response?.data?.error || 'Error al guardar');
    }
  };

  const handleChangePassword = async () => {
    setPwError(''); setPwSuccess(false);
    if (pwForm.newPassword !== pwForm.confirm) { setPwError('Las contraseñas no coinciden'); return; }
    if (pwForm.newPassword.length < 6) { setPwError('Mínimo 6 caracteres'); return; }
    try {
      await changePassword({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      setPwSuccess(true);
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) { setPwError(err.response?.data?.error || 'Error'); }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto" data-testid="settings-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === t.id ? 'bg-accent/20 text-accent' : 'text-[#6E7681] hover:bg-surface-hover'
            }`}
            data-testid={`settings-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'negocio' && (
        <div className="card">
          <div className="card-title">Configuración del Negocio</div>
          <div className="space-y-4">
            <Input label="Gasto Fijo Mensual (COP)" type="number" value={settings.fixedMonthly} onChange={e => setSettings(p => ({ ...p, fixedMonthly: e.target.value }))} help="Parqueadero, publicidad fija, etc. Se proratea por vehículo." />
            <Input label="Alerta de Días en Inventario" type="number" value={settings.alertDays} onChange={e => setSettings(p => ({ ...p, alertDays: e.target.value }))} help="Después de estos días, el carro muestra alerta amarilla." />
            <button onClick={handleSaveSettings} className="btn-primary">Guardar Configuración</button>
          </div>
        </div>
      )}

      {tab === 'comisiones' && (
        commCfg ? (
          <div className="card" data-testid="settings-commissions-card">
            <div className="card-title">Comisiones y bolsillos</div>
            <p className="text-xs text-[#6E7681] mb-3">
              Cómo se reparte la ganancia bruta de cada venta. Los tres porcentajes deben sumar 100.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Input label="Comisiones %" type="number" value={commCfg.commission_share_pct}
                  onChange={e => setCommCfg({ ...commCfg, commission_share_pct: e.target.value })}
                  data-testid="settings-commission-pct" />
                <Input label="Reinversión %" type="number" value={commCfg.reinvest_share_pct}
                  onChange={e => setCommCfg({ ...commCfg, reinvest_share_pct: e.target.value })}
                  data-testid="settings-reinvest-pct" />
                <Input label="Impuestos %" type="number" value={commCfg.tax_share_pct}
                  onChange={e => setCommCfg({ ...commCfg, tax_share_pct: e.target.value })}
                  data-testid="settings-tax-pct" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Captador % (default)" type="number" value={commCfg.default_captador_pct}
                  onChange={e => setCommCfg({ ...commCfg, default_captador_pct: e.target.value })}
                  data-testid="settings-captador-pct" />
                <Input label="Cerrador % (default)" type="number" value={commCfg.default_cerrador_pct}
                  onChange={e => setCommCfg({ ...commCfg, default_cerrador_pct: e.target.value })}
                  data-testid="settings-cerrador-pct" />
              </div>
              <div className="text-xs text-[#8B949E]">
                Fondo Reinversión: <span className="text-[#E6EDF3] font-mono">{commCfg.reinvest_account?.name || commCfg.reinvest_account_id}</span>
                {' · '}
                Reserva Impuestos: <span className="text-[#E6EDF3] font-mono">{commCfg.tax_reserve_account?.name || commCfg.tax_reserve_account_id}</span>
              </div>
              {commError && <div className="text-[12px] text-red-400">{commError}</div>}
              {commSuccess && <div className="text-[12px] text-green-400">Guardado.</div>}
              <button onClick={handleSaveCommissions} className="btn-primary" data-testid="settings-save-commissions">
                Guardar configuración de comisiones
              </button>
            </div>
          </div>
        ) : (
          <div className="card text-sm text-[#6E7681]">Configuración de comisiones no disponible.</div>
        )
      )}

      {tab === 'cuenta' && (
        <div className="card">
          <div className="card-title">Cambiar Contraseña</div>
          <div className="space-y-4">
            <Input label="Contraseña Actual" type="password" value={pwForm.currentPassword} onChange={e => setPwForm(p => ({ ...p, currentPassword: e.target.value }))} />
            <Input label="Nueva Contraseña" type="password" value={pwForm.newPassword} onChange={e => setPwForm(p => ({ ...p, newPassword: e.target.value }))} />
            <Input label="Confirmar Nueva Contraseña" type="password" value={pwForm.confirm} onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} />
            {pwError && <p className="text-xs text-[#F85149]">{pwError}</p>}
            {pwSuccess && <p className="text-xs text-[#3FB950]">Contraseña actualizada</p>}
            <button onClick={handleChangePassword} className="btn-primary">Actualizar Contraseña</button>
          </div>
        </div>
      )}

      {tab === 'usuarios' && role === 'ADMIN' && <UsersSection />}
    </div>
  );
}
```

- [ ] **Step 2: Verificar build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SettingsPage.jsx
git commit -m "feat(settings): reorganizar configuración en pestañas responsive"
```

---

## Task 4: Timeout de inactividad (hook + modal + integración)

**Files:**
- Create: `frontend/src/hooks/useIdleTimeout.js`
- Create: `frontend/src/components/auth/IdleWarningModal.jsx`
- Modify: `frontend/src/components/layout/AppLayout.jsx`

- [ ] **Step 1: Crear el hook `useIdleTimeout`**

Crear `frontend/src/hooks/useIdleTimeout.js`:

```js
import { useEffect, useRef, useState, useCallback } from 'react';

const DEV = import.meta.env.DEV;
const toNum = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export const IDLE_LIMIT_MS = toNum(import.meta.env.VITE_IDLE_LIMIT_MS, 60 * 60 * 1000); // 1 hora
export const WARN_BEFORE_MS = toNum(import.meta.env.VITE_IDLE_WARN_MS, 60 * 1000);       // 1 minuto

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];

// Devuelve { warning, stayActive }. Llama onIdle() al cumplirse el límite sin actividad.
export function useIdleTimeout({ enabled, onIdle }) {
  const [warning, setWarning] = useState(false);
  const warnTimer = useRef(null);
  const idleTimer = useRef(null);
  const lastReset = useRef(0);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  // Override solo en dev/test (Vite dev): permite umbrales chicos sin afectar producción.
  const limit = (DEV && typeof window !== 'undefined' && window.__IDLE_LIMIT_MS__) || IDLE_LIMIT_MS;
  const warnBefore = (DEV && typeof window !== 'undefined' && window.__IDLE_WARN_MS__) || WARN_BEFORE_MS;

  const clearTimers = useCallback(() => {
    if (warnTimer.current) clearTimeout(warnTimer.current);
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setWarning(false);
    if (!enabled) return;
    warnTimer.current = setTimeout(() => setWarning(true), Math.max(0, limit - warnBefore));
    idleTimer.current = setTimeout(() => { setWarning(false); onIdleRef.current(); }, limit);
  }, [enabled, limit, warnBefore, clearTimers]);

  useEffect(() => {
    if (!enabled) { clearTimers(); setWarning(false); return undefined; }
    reset();
    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset.current > 1000) { lastReset.current = now; reset(); }
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      clearTimers();
    };
  }, [enabled, reset, clearTimers]);

  return { warning, stayActive: reset };
}
```

- [ ] **Step 2: Crear `IdleWarningModal`**

Crear `frontend/src/components/auth/IdleWarningModal.jsx`:

```jsx
import Modal from '@/components/shared/Modal';

export default function IdleWarningModal({ isOpen, onStay, onLogout }) {
  return (
    <Modal isOpen={isOpen} onClose={onStay} title="Sesión por expirar">
      <div className="space-y-4" data-testid="idle-warning-modal">
        <p className="text-sm text-[#8B949E]">Tu sesión se cerrará por inactividad en 1 minuto. ¿Querés seguir conectado?</p>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onLogout} data-testid="idle-logout">Cerrar sesión</button>
          <button className="btn-primary flex-1" onClick={onStay} data-testid="idle-stay">Seguir conectado</button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Integrar en `AppLayout`**

En `frontend/src/components/layout/AppLayout.jsx`:

(a) En los imports de `react-router-dom`, agregar `useNavigate` (queda `import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';`). Asegurar que `useCallback` esté importado desde `react` (agregarlo si falta).

(b) Agregar los imports nuevos junto a los demás:

```jsx
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import IdleWarningModal from '@/components/auth/IdleWarningModal';
```

(c) Dentro del componente `AppLayout`, después de `const { logout, role } = useAuth();`, agregar:

```jsx
  const navigate = useNavigate();
  const handleIdleLogout = useCallback(async () => { await logout(); navigate('/login'); }, [logout, navigate]);
  const { warning: idleWarning, stayActive } = useIdleTimeout({ enabled: true, onIdle: handleIdleLogout });
```

(d) Justo antes del cierre del `</div>` raíz del return de `AppLayout` (el contenedor más externo), renderizar el modal:

```jsx
      <IdleWarningModal isOpen={idleWarning} onStay={stayActive} onLogout={handleIdleLogout} />
```

> `AppLayout` solo se monta dentro de `ProtectedRoute` (usuario autenticado), por eso `enabled: true` es correcto.

- [ ] **Step 4: Verificar build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useIdleTimeout.js frontend/src/components/auth/IdleWarningModal.jsx frontend/src/components/layout/AppLayout.jsx
git commit -m "feat(auth): cierre de sesión por inactividad (1h, aviso 1min antes)"
```

---

## Task 5: Viewer — ocultar controles de escritura

En cada página: importar `useAuth` (si no está) y obtener `const { isViewer } = useAuth();`, luego envolver cada control de escritura en `{!isViewer && ( ... )}`. Las lecturas no cambian.

**Files:**
- Modify: `frontend/src/pages/ExpensesPage.jsx`
- Modify: `frontend/src/pages/treasury/LoansPage.jsx`
- Modify: `frontend/src/pages/treasury/DebtsPage.jsx`
- Modify: `frontend/src/pages/treasury/AccountsPage.jsx`
- Modify: `frontend/src/pages/treasury/PayablesPage.jsx`

- [ ] **Step 1: `ExpensesPage`**

Agregar `import { useAuth } from '@/contexts/AuthContext';` y dentro del componente `const { isViewer } = useAuth();`. Envolver en `{!isViewer && ( ... )}`:
- El botón `data-testid="expenses-create-button"` (`+ Gasto`).
- Los botones de acción por fila del gasto (editar / eliminar / pagar) que hoy están sin gatear (los `<button>` dentro del map de gastos, alrededor de las líneas 102–135).

- [ ] **Step 2: `treasury/LoansPage`**

Importar `useAuth` y `const { isViewer } = useAuth();`. Envolver en `{!isViewer && (...)}`:
- El botón `data-testid="loans-create-button"` (`+ Nuevo préstamo`).
- El botón de pago por card `data-testid={`loan-card-${loan.id}-pay-button`}`.

- [ ] **Step 3: `treasury/DebtsPage`**

Importar `useAuth` y `const { isViewer } = useAuth();`. Envolver en `{!isViewer && (...)}`:
- `data-testid="debts-create-button"` (`+ Nuevo crédito`).
- `data-testid={`debt-card-${debt.id}-pay-button`}` (Pagar cuota).
- `data-testid={`debt-card-${debt.id}-reconcile-button`}` (Reconciliar).

- [ ] **Step 4: `treasury/AccountsPage`**

Importar `useAuth` y `const { isViewer } = useAuth();`. Envolver en `{!isViewer && (...)}`:
- El botón `+ Nueva Cuenta` (`onClick={openCreate}`).
- Los botones `Editar` (`onClick={() => openEdit(account)}`) y `Eliminar` (`onClick={() => handleDelete(account.id)}`) de cada cuenta.

- [ ] **Step 5: `treasury/PayablesPage`**

Importar `useAuth` y `const { isViewer } = useAuth();`. Envolver en `{!isViewer && (...)}` el/los botón(es) que abren el modal de pago (`setShowPaymentModal(true)`, alrededor de la línea 176) — el botón de "Registrar pago" / "Pagar" de cada CxC/CxP.

- [ ] **Step 6: Verificar build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ExpensesPage.jsx frontend/src/pages/treasury/LoansPage.jsx frontend/src/pages/treasury/DebtsPage.jsx frontend/src/pages/treasury/AccountsPage.jsx frontend/src/pages/treasury/PayablesPage.jsx
git commit -m "feat(auth): ocultar controles de escritura para rol VIEWER en todas las pantallas"
```

---

## Task 6: E2E — UX y sesión

**Files:**
- Create: `tests/e2e/ux/ux-session.spec.ts`
- Reference: `tests/fixtures/auth.ts` (`loginAsAdmin`), `tests/helpers/api.ts` (`apiRequestRaw`, `apiCreateUser`, `apiMe`), `tests/helpers/db.ts` (`setUserRole`)

- [ ] **Step 1: Crear el spec**

Crear `tests/e2e/ux/ux-session.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiRequestRaw, apiCreateUser, apiMe } from '../../helpers/api';
import { setUserRole } from '../../helpers/db';

const ADMIN_EMAIL = 'admin@autocontrol.co';
const uniq = () => `u${Date.now().toString().slice(-7)}@test.co`;

test.describe('UX y sesión', () => {
  test.afterEach(async () => { await setUserRole(ADMIN_EMAIL, 'ADMIN'); });

  test('login no muestra pista de credenciales', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/PIN por defecto/i)).toHaveCount(0);
  });

  test('Settings con tabs: ADMIN ve Usuarios; no-ADMIN no', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings');
    await expect(page.getByTestId('settings-tabs')).toBeVisible();
    await expect(page.getByTestId('settings-tab-usuarios')).toBeVisible();
    // cambiar a la tab Usuarios muestra la card de usuarios
    await page.getByTestId('settings-tab-usuarios').click();
    await expect(page.getByTestId('settings-users-card')).toBeVisible();

    // como no-ADMIN, la tab Usuarios desaparece
    await setUserRole(ADMIN_EMAIL, 'SUPERVISOR');
    await page.reload();
    await expect(page.getByTestId('settings-tab-negocio')).toBeVisible();
    await expect(page.getByTestId('settings-tab-usuarios')).toHaveCount(0);
  });

  test('VIEWER no ve controles de escritura', async ({ page }) => {
    await loginAsAdmin(page);
    await setUserRole(ADMIN_EMAIL, 'VIEWER');

    await page.goto('/expenses');
    await expect(page.getByTestId('expenses-create-button')).toHaveCount(0);

    await page.goto('/treasury/loans');
    await expect(page.getByTestId('loans-create-button')).toHaveCount(0);

    await page.goto('/treasury/debts');
    await expect(page.getByTestId('debts-create-button')).toHaveCount(0);

    await page.goto('/');
    await expect(page.getByTestId('kanban-create-vehicle')).toHaveCount(0);
    await expect(page.getByTestId('viewer-readonly-badge')).toBeVisible({ timeout: 10_000 });
  });

  test('inactividad: avisa y cierra sesión', async ({ page }) => {
    // Umbrales chicos solo para este test (override de dev en el hook).
    await page.addInitScript(() => {
      window.__IDLE_LIMIT_MS__ = 4000;
      window.__IDLE_WARN_MS__ = 2000;
    });
    await loginAsAdmin(page);
    await page.goto('/dashboard');

    // Aparece el aviso (~2s) y luego cierra sesión → vuelve a /login (~4s)
    await expect(page.getByTestId('idle-warning-modal')).toBeVisible({ timeout: 8_000 });
    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  });

  test('sesiones de usuarios distintos son independientes', async ({ page }) => {
    const adminToken = await loginAsAdmin(page);
    const email = uniq();
    await apiCreateUser(adminToken, { email, password: 'Pass12345', role: 'SUPERVISOR' });
    const otherToken = (await apiRequestRaw('POST', '/auth/login', '', { email, password: 'Pass12345' })).body as { accessToken?: string };
    const bToken = otherToken.accessToken as string;

    // Ambos tokens siguen válidos y devuelven su propio usuario
    expect((await apiMe(adminToken)).user.email).toBe(ADMIN_EMAIL);
    expect((await apiMe(bToken)).user.email).toBe(email);
    // operar con uno no invalida al otro
    expect((await apiRequestRaw('GET', '/vehicles', bToken)).status).toBe(200);
    expect((await apiMe(adminToken)).user.email).toBe(ADMIN_EMAIL);
  });
});
```

> Notas: el override de inactividad funciona porque en e2e el frontend corre con `npm run dev` (Vite dev → `import.meta.env.DEV` true) y `page.addInitScript` setea `window.__IDLE_*` por test, sin afectar a los demás. `loginAsAdmin` ya hace el login vía UI/almacena token; confirmá que devuelve el accessToken (igual que en specs previos). Si `loginAsAdmin` navega y deja la sesión, el `addInitScript` debe ejecutarse antes (ya se llama antes de `loginAsAdmin`).

- [ ] **Step 2: Correr el spec nuevo**

Run: `npx playwright test tests/e2e/ux/ux-session.spec.ts`
Expected: 5 passed.

- [ ] **Step 3: Regresión (auth + un treasury)**

Run: `npx playwright test tests/e2e/auth/ tests/e2e/treasury/loans.spec.ts`
Expected: verde (viewer-readonly y user-management siguen pasando).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/ux/ux-session.spec.ts
git commit -m "test(ux): e2e de settings tabs, login, inactividad, viewer y sesiones"
```

---

## Verificación final

- [ ] **Build frontend:** `cd frontend && npm run build` → ok.
- [ ] **Unit backend:** `cd backend && node --test src/` → verde (no cambió backend, sanity).
- [ ] **E2E:** `npx playwright test tests/e2e/ux/ tests/e2e/auth/` → verde.
- [ ] Invocar `verification-loop` antes de marcar completo.
```
