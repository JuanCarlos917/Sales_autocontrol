# Skill: Testing — AutoControl

## Frameworks

| Capa | Framework | Comando |
|------|-----------|---------|
| Backend | Jest | `cd backend && npm test` |
| Frontend | Vitest | `cd frontend && npm test` |

## Estructura de archivos

Los tests van en `__tests__/` junto al archivo que testean:

```
backend/src/services/vehicleService.js
backend/src/services/__tests__/vehicleService.test.js

backend/src/controllers/vehicleController.js
backend/src/controllers/__tests__/vehicleController.test.js

frontend/src/components/vehicles/VehicleCard.jsx
frontend/src/components/vehicles/__tests__/VehicleCard.test.jsx
```

## Reglas obligatorias

- Todo nuevo **service** debe tener tests unitarios
- Todo nuevo **endpoint** debe tener tests de integración
- Correr tests antes de hacer cualquier commit

```bash
# Verificar antes de commit
cd backend && npm test && cd ../frontend && npm test
```

## Tests de service (unitarios — backend)

```js
// backend/src/services/__tests__/vehicleService.test.js
const { createVehicle } = require('../vehicleService');
const { prisma } = require('../../config/database');

jest.mock('../../config/database');

describe('vehicleService', () => {
  it('crea un vehículo con los datos correctos', async () => {
    prisma.vehicle.create.mockResolvedValue({ id: '1', plate: 'ABC123' });
    const result = await createVehicle({ plate: 'ABC123' }, 'user-id');
    expect(result.plate).toBe('ABC123');
  });
});
```

## Tests de endpoint (integración — backend)

```js
// backend/src/controllers/__tests__/vehicleController.test.js
const request = require('supertest');
const app = require('../../server');

describe('POST /api/vehicles', () => {
  it('retorna 401 sin token', async () => {
    const res = await request(app).post('/api/vehicles').send({});
    expect(res.status).toBe(401);
  });

  it('crea vehículo con datos válidos', async () => {
    const res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ plate: 'ABC123' });
    expect(res.status).toBe(201);
  });
});
```

## Tests de componente (frontend)

```jsx
// frontend/src/components/vehicles/__tests__/VehicleCard.test.jsx
import { render, screen } from '@testing-library/react';
import VehicleCard from '../VehicleCard';

it('muestra la placa del vehículo', () => {
  render(<VehicleCard vehicle={{ plate: 'ABC123', brand: 'Toyota' }} />);
  expect(screen.getByText('ABC123')).toBeInTheDocument();
});
```

## Cobertura mínima esperada

- Services: 80% de cobertura de líneas
- Controllers: cubrir casos happy path + errores 400/401/404
- Componentes: cubrir render y interacciones principales
