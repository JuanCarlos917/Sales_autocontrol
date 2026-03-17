# Guía de Contribución — AutoControl

## Flujo de Ramas (Git Flow Simplificado)

```
main
 └── dev
      ├── feat/nombre-del-feature
      ├── fix/nombre-del-bug
      └── hotfix/nombre-urgente  ← sale de main, mergea a main + dev
```

---

## Ramas Principales

### `main`
- Refleja el código en **producción**
- **Nadie hace commits directos** — solo recibe merges desde `dev` (releases) o `hotfix/*` (urgencias)
- Cada merge a `main` debe tener su tag de versión: `git tag v1.0.0`

### `dev`
- Rama de **integración y desarrollo activo**
- Es la rama por defecto para abrir Pull Requests
- Debe estar siempre en estado funcional (los tests deben pasar)
- Se mergea a `main` cuando se aprueba un release

---

## Ramas de Trabajo

### `feat/*` — Nuevas funcionalidades
```bash
# Crear desde dev
git checkout dev && git pull
git checkout -b feat/kanban-drag-and-drop

# Al terminar, abrir PR hacia dev
git push -u origin feat/kanban-drag-and-drop
```
- Ejemplos: `feat/login-con-pin`, `feat/reporte-mensual`, `feat/upload-documentos`
- Se eliminan después de mergear

### `fix/*` — Corrección de bugs no urgentes
```bash
git checkout dev && git pull
git checkout -b fix/calculo-participacion

git push -u origin fix/calculo-participacion
```
- Ejemplos: `fix/fecha-venta-nula`, `fix/gastos-duplicados`
- PR hacia `dev`

### `hotfix/*` — Correcciones urgentes en producción
```bash
# Sale directamente de main
git checkout main && git pull
git checkout -b hotfix/precio-venta-incorrecto

# Al terminar, mergear a main Y a dev
git push -u origin hotfix/precio-venta-incorrecto
```
- PR hacia `main` (urgente) y luego hacia `dev` (para no perder el fix)
- Ejemplos: `hotfix/vulnerabilidad-auth`, `hotfix/crash-dashboard`

---

## Convenciones de Commits

Seguimos [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<alcance>): <descripción en imperativo>

feat(vehicles): agregar filtro por rango de precio
fix(auth): corregir expiración de refresh token
chore(deps): actualizar prisma a 5.21
docs(api): documentar endpoint de gastos
refactor(financial): extraer cálculo de prorrateoo a función pura
```

| Tipo | Cuándo usarlo |
|------|--------------|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de bug |
| `hotfix` | Fix urgente en producción |
| `chore` | Mantenimiento, dependencias, config |
| `docs` | Solo documentación |
| `refactor` | Cambio de código sin cambiar comportamiento |
| `test` | Agregar o corregir tests |

---

## Flujo Completo de un Feature

```bash
# 1. Partir siempre desde dev actualizado
git checkout dev
git pull origin dev

# 2. Crear la rama
git checkout -b feat/mi-feature

# 3. Trabajar y hacer commits frecuentes
git add .
git commit -m "feat(vehicles): agregar campo de cruce de vehículo"

# 4. Mantener la rama actualizada con dev
git fetch origin
git rebase origin/dev

# 5. Subir y abrir PR
git push -u origin feat/mi-feature
# → Abrir PR en GitHub: feat/mi-feature → dev
```

---

## Reglas de Pull Request

1. El PR debe poder revisarse en menos de 400 líneas cambiadas — si es más grande, dividirlo
2. El título del PR sigue el mismo formato de Conventional Commits
3. Descripción mínima: qué hace, por qué, y cómo probarlo
4. No hacer merge a `main` sin pasar por `dev` primero (excepto `hotfix/*`)
5. Borrar la rama después de mergear

---

## Comandos de Referencia Rápida

```bash
# Ver todas las ramas
git branch -a

# Actualizar dev local
git checkout dev && git pull

# Eliminar rama local ya mergeada
git branch -d feat/mi-feature

# Eliminar rama remota ya mergeada
git push origin --delete feat/mi-feature

# Ver historial limpio
git log --oneline --graph --all
```
