# Spec: UX y sesión — Settings con tabs, timeout de inactividad, viewer read-only

- **Fecha:** 2026-06-14
- **Estado:** Aprobado (diseño)
- **Módulo:** Frontend (Configuración, Login, Auth/sesión, roles) — sin cambios de schema

## Problema / objetivo

Cinco mejoras de UX y sesión, agrupadas en un solo spec por ser cambios acotados y relacionados:

1. **Settings poco profesional**: `/settings` apila cards sueltas. Reorganizar con **pestañas** responsive.
2. **Login** muestra una pista de credenciales por defecto que no debe estar en producción.
3. **Inactividad**: no hay cierre de sesión automático; debe cerrarse tras **1 hora** sin actividad, en cualquier rol.
4. **Concurrencia**: la preocupación es que sesiones de distintos roles "se pisen".
5. **Viewer**: debe poder **ver todo** (pipeline, vehículos, ventas, tesorería) pero **solo lectura**.

## Hallazgo de investigación (concurrencia)

`authenticate` (`middleware/auth.js`) solo hace `jwt.verify` (firma + expiración) y carga el usuario por `decoded.userId`. **El `jti` no se valida contra la base; no existe lógica de "sesión única".** Los refresh tokens son por-fila y rotan individualmente (`authService.refreshToken` borra solo el token usado); `login` no invalida sesiones ajenas. **Por lo tanto, con el código actual dos usuarios en dispositivos distintos no pueden cerrarse la sesión entre sí.** El choque observado corresponde a usar el **mismo navegador** (localStorage `accessToken`/`refreshToken` es compartido entre pestañas) o a compartir cuenta.

**Decisión:** no se cambia el servidor. Se agrega un **e2e** que demuestra que dos usuarios concurrentes mantienen sesiones independientes. Si el test fallara, se trataría como bug y se aborda; si pasa, queda garantizado.

## Decisiones de diseño (confirmadas)

| Tema | Resolución |
|---|---|
| Layout Settings | **Pestañas** (Negocio · Comisiones · Cuenta · Usuarios[ADMIN]), responsive |
| Texto del login | Eliminar la pista "PIN por defecto…" |
| Inactividad | **1 h** sin actividad → cerrar sesión; **aviso 1 min antes** con opción de seguir conectado; aplica a todos los roles |
| Concurrencia | Sin cambio de servidor; e2e que prueba sesiones independientes |
| Viewer | **Ocultar** todos los controles de escritura en todas las superficies |

---

## 1. Settings con pestañas

- Refactor de `frontend/src/pages/SettingsPage.jsx` a un layout con tabs. Tabs:
  - **Negocio** — gastos fijos / alertDays (lógica `handleSaveSettings`).
  - **Comisiones** — config de comisiones (la card existente, ya gated por su propia condición).
  - **Cuenta** — cambiar contraseña (card existente).
  - **Usuarios** — `UsersSection` (solo se muestra la tab si `role === 'ADMIN'`).
- Estado local `activeTab`. Contenedor de tabs con scroll horizontal en móvil (`overflow-x-auto`),
  estilo consistente con las tabs ya usadas en el proyecto (p. ej. `LoansPage`/`PayablesPage`).
- Cada tab renderiza el contenido de su card actual; **no se cambia la lógica**, solo el contenedor.
- Extraer el contenido de cada card a sub-componentes locales o secciones para mantener el archivo
  enfocado (`SettingsPage` < 200 líneas; si crece, separar tabs en componentes).

## 2. Quitar texto del login

- Eliminar la línea `<p className="text-[10px] ...">PIN por defecto: 1234 · Email: admin@autocontrol.co</p>`
  en `frontend/src/pages/LoginPage.jsx` (~línea 70). El placeholder del input de email puede quedarse
  como genérico o cambiarse a algo neutro; no muestra credenciales reales.

## 3. Timeout de inactividad (1 h, aviso 1 min antes)

- Hook nuevo `frontend/src/hooks/useIdleTimeout.js`:
  - Parámetros/constantes: `IDLE_LIMIT_MS = 60*60*1000` (1 h), `WARN_BEFORE_MS = 60*1000` (1 min).
  - Escucha actividad del usuario: `mousemove`, `mousedown`, `keydown`, `scroll`, `touchstart`
    (con throttling para no resetear en cada evento).
  - A los `IDLE_LIMIT_MS - WARN_BEFORE_MS` (59 min) dispara un estado `warning = true`.
  - Si hay actividad o el usuario pulsa "Seguir conectado", reinicia el contador y oculta el aviso.
  - Al cumplirse `IDLE_LIMIT_MS` sin actividad, ejecuta el callback de logout.
- Integración en `AuthContext` (o en `AppLayout`, que ya envuelve las rutas autenticadas):
  - Activo **solo cuando hay sesión** (`isAuthenticated`).
  - Al expirar: `logout()` + redirección a `/login` (más un querystring o estado opcional para mostrar
    "Sesión cerrada por inactividad").
- **Modal de aviso** (`IdleWarningModal`): "Tu sesión se cerrará por inactividad en 1 minuto" con botones
  "Seguir conectado" (resetea) y "Cerrar sesión" (logout inmediato). Reusa `@/components/shared/Modal`.
- Limpieza correcta de timers y listeners en `useEffect` cleanup.

## 4. Concurrencia — sesiones independientes (sin cambio de servidor)

- E2E que valida: el usuario A (ADMIN) y el usuario B (creado VIEWER/SUPERVISOR) obtienen tokens
  por separado y ambos siguen autenticados tras operar en paralelo (cada uno hace `GET /auth/me`
  con su token y recibe su propio usuario; ninguna acción de uno invalida el token del otro).
- Si el test pasa (esperado por el análisis), documenta y garantiza la independencia. Si fallara,
  se reabre como bug.

## 5. Viewer read-only en todas las superficies (ocultar controles)

- Exponer un booleano `isViewer` desde `AuthContext` (`role === 'VIEWER'`), además del `role` ya disponible.
- **Ocultar** los controles de escritura cuando `isViewer` en todas las pantallas:
  - Pipeline/Kanban (crear vehículo, mover etapa, registrar venta).
  - Vehículos (crear/editar/eliminar) y Detalle de vehículo (editar, gastos, vender, mover, documentos).
  - Tesorería: cuentas (crear/editar), transacciones (ingreso/egreso/transferencia), préstamos
    (nuevo/pago), créditos (nuevo/pago/reconciliar), CxC/CxP (registrar pago).
  - Gastos (crear/editar/eliminar).
  - Configuración: el VIEWER no ve "Usuarios" (ya gated a ADMIN); "Cambiar contraseña" sí (es su propia cuenta).
- El badge "solo lectura" existente (`viewer-readonly-badge`) se mantiene.
- Backend ya bloquea cualquier escritura para VIEWER (`blockViewerWrites`) — esta capa es UX/defensa en profundidad.

## Estrategia de pruebas (E2E Playwright, sin migración)

- **Settings tabs:** navegar a `/settings` como ADMIN, ver las 4 tabs; como no-ADMIN no aparece "Usuarios";
  cambiar de tab muestra el contenido correcto.
- **Login:** la pista de credenciales ya no está en el DOM del login.
- **Inactividad:** con umbrales reducidos vía override de constante para test (o exponer prop), simular
  inactividad → aparece el modal → al expirar redirige a `/login`. (Si el reloj real es inviable en e2e,
  unit-test del hook con timers falsos.)
- **Concurrencia:** dos tokens de usuarios distintos, ambos válidos tras operar; `GET /auth/me` de cada
  uno devuelve su propio usuario.
- **Viewer:** logueado como VIEWER, las pantallas cargan (200) y los `data-testid` de los controles de
  escritura no están presentes; el badge de solo lectura sí.

**Cobertura objetivo:** ≥ 80% en lo nuevo (hook + componentes).

## Fuera de alcance (YAGNI)

- Control/listado de sesiones activas o límite de sesiones por usuario.
- Cambiar el almacenamiento de tokens (localStorage → cookies httpOnly) — mejora de seguridad mayor, aparte.
- Timeout configurable por usuario/rol (se usa 1 h fijo).
- Rediseño visual profundo de cada card de Settings (solo se reorganiza en tabs).
