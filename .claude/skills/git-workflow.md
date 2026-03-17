# Skill: Git Workflow — AutoControl

## Estructura de ramas

```
main        ← producción, solo merges desde dev o hotfix/*
 └── dev    ← desarrollo activo, rama por defecto para PRs
      ├── feat/nombre-feature
      ├── fix/nombre-bug
      └── hotfix/nombre-urgente  ← sale de main, mergea a main + dev
```

## Flujo de trabajo diario

```bash
# Siempre partir desde dev actualizado
git checkout dev
git pull origin dev

# Crear rama para el trabajo
git checkout -b feat/nombre-descriptivo
```

## Convenciones de commits

Commits en español, con prefijo en inglés:

```bash
feat: agregar filtro de vehículos por precio
fix: corregir cálculo de participación en gastos
refactor: extraer lógica de prorrateoo a función separada
docs: actualizar README con instrucciones de deploy
test: agregar tests unitarios para vehicleService
chore: actualizar dependencias de prisma
```

Formato: `<prefijo>(<alcance opcional>): <descripción en imperativo>`

## Antes de cada commit

```bash
# 1. Correr tests
cd backend && npm test
cd frontend && npm test

# 2. Correr linting
cd backend && npm run lint
cd frontend && npm run lint

# 3. Solo si todo pasa, hacer commit
git add <archivos específicos>
git commit -m "feat: descripción del cambio"
```

Nunca usar `git add .` sin revisar qué archivos se están incluyendo.
Nunca incluir `.env`, `node_modules/`, `uploads/` en commits.

## Reglas absolutas

- **Nunca** hacer `git push` directo a `main`
- **Nunca** hacer `git push --force` en `dev` o `main`
- **Siempre** crear rama nueva por feature o fix
- Los merges a `main` solo via PR aprobado desde `dev`

## Hotfix urgente en producción

```bash
# 1. Salir de main
git checkout main && git pull origin main
git checkout -b hotfix/descripcion-urgente

# 2. Hacer el fix, commit y push
git commit -m "fix: descripcion del problema critico"
git push -u origin hotfix/descripcion-urgente

# 3. PR a main (urgente) + PR a dev (para no perder el fix)
```

## Tags de versión en releases

```bash
# Al mergear a main
git checkout main && git pull
git tag v1.0.0
git push origin v1.0.0
```

## Limpieza de ramas

```bash
# Eliminar rama local después de mergear
git branch -d feat/mi-feature

# Eliminar rama remota después de mergear
git push origin --delete feat/mi-feature
```
