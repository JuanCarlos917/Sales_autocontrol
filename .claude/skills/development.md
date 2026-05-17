# Skill: Desarrollo Local — AutoControl

## Levantar el proyecto

```bash
# Backend (puerto 4000)
cd backend && npm run dev

# Frontend (puerto 5173)
cd frontend && npm run dev
```

Prerequisito: PostgreSQL corriendo (`brew services start postgresql@16`) y `backend/.env` configurado.

## Migraciones de Prisma

```bash
cd backend

# Crear y aplicar migración
npx prisma migrate dev --name descripcion_del_cambio

# Solo aplicar migraciones existentes (producción)
npx prisma migrate deploy

# Validar schema antes de migrar
npx prisma validate

# Regenerar cliente después de cambiar schema
npx prisma generate

# UI visual de la DB
npx prisma studio
```

## Crear un nuevo endpoint

Seguir siempre este orden:

1. **Schema de validación** — `backend/src/middleware/validation.js`
```js
const createXxxSchema = Joi.object({ field: Joi.string().required() });
exports.validateCreateXxx = validate(createXxxSchema);
```

2. **Service** — `backend/src/services/xxxService.js`
```js
// Toda la lógica de negocio aquí. Sin req/res.
const createXxx = async (data, userId) => { ... };
module.exports = { createXxx };
```

3. **Controller** — `backend/src/controllers/xxxController.js`
```js
// Solo maneja req/res. Delega al service.
const createXxx = async (req, res, next) => {
  try {
    const result = await xxxService.createXxx(req.body, req.user.id);
    res.status(201).json(result);
  } catch (err) { next(err); }
};
```

4. **Route** — `backend/src/routes/xxx.js`
```js
router.post('/', authenticate, validateCreateXxx, createXxx);
```

5. **Registrar en** `backend/src/routes/index.js`
```js
router.use('/xxx', require('./xxx'));
```

## Crear un nuevo componente React

- Ubicación: `frontend/src/components/{dominio}/NombreComponente.jsx`
- Dominios existentes: `vehicles/`, `expenses/`, `documents/`, `layout/`, `shared/`
- Usar PascalCase para el nombre del archivo
- Si es reutilizable entre dominios → va en `shared/`
- Importar con ES Modules (`import`, no `require`)

```jsx
// frontend/src/components/vehicles/VehicleCard.jsx
const VehicleCard = ({ vehicle }) => {
  return <div>...</div>;
};
export default VehicleCard;
```

## Linting

Correr siempre después de editar archivos:

```bash
# Backend
cd backend && npm run lint

# Frontend
cd frontend && npm run lint
```

Si no hay script de lint configurado aún, correr:
```bash
npx eslint src/ --ext .js,.jsx
```
