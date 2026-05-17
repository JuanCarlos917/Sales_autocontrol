# Skill: Seguridad — AutoControl

## Variables de entorno

Nunca hardcodear secretos en el código. Siempre usar `process.env.*`:

```js
// MAL
const secret = 'mi-secreto-hardcodeado';

// BIEN
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET no configurado');
```

Variables sensibles requeridas: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, `ADMIN_PASSWORD`.
Ninguna de estas debe aparecer en el código ni en git. `.env` está en `.gitignore`.

## Autenticación en endpoints

Todo endpoint requiere el middleware `authenticate` excepto:
- `POST /api/auth/login`
- `POST /api/auth/pin-login`
- `POST /api/auth/refresh`

```js
// Aplicar en cada route que lo requiera
router.get('/', authenticate, getVehicles);
router.post('/', authenticate, validateCreate, createVehicle);

// NUNCA omitir authenticate en rutas protegidas
```

## Validación de inputs con Joi

Todo endpoint que recibe datos del cliente debe validar con un schema Joi antes de llegar al controller:

```js
// En middleware/validation.js
const createVehicleSchema = Joi.object({
  plate: Joi.string().max(10).required(),
  purchasePrice: Joi.number().integer().min(0).optional(),
});

// En la route
router.post('/', authenticate, validate(createVehicleSchema), createVehicle);
```

Nunca procesar `req.body` sin validación previa.

## Verificación de ownership

En cada operación sobre un recurso, verificar que pertenece al usuario autenticado:

```js
// En el service — siempre filtrar por userId
const getVehicle = async (id, userId) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id, userId },  // ← ownership check
  });
  if (!vehicle) throw new NotFoundError('Vehículo no encontrado');
  return vehicle;
};
```

Nunca buscar solo por `id` sin incluir `userId` en el where.

## Sanitización de nombres de archivo en uploads

```js
// En middleware/upload.js — sanitizar el nombre antes de guardar
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')  // solo caracteres seguros
    .replace(/\.{2,}/g, '.')             // prevenir path traversal (..)
    .substring(0, 255);                  // limitar longitud
};
```

Nunca usar el nombre de archivo original del cliente directamente.

## Stack traces en producción

El error handler debe ocultar detalles internos en producción:

```js
// En middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  const isDev = process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor',
    ...(isDev && { stack: err.stack }),  // solo en desarrollo
  });
};
```

## Checklist de seguridad por endpoint nuevo

- [ ] Middleware `authenticate` aplicado
- [ ] Schema Joi definido y aplicado
- [ ] Ownership verificado (filtro por `userId`)
- [ ] Nombre de archivo sanitizado (si hay upload)
- [ ] Sin `console.log` de datos sensibles (tokens, passwords)
