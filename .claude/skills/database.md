# Skill: Base de Datos — AutoControl

## Fuente de verdad

`backend/prisma/schema.prisma` es la única fuente de verdad del esquema.
Nunca modificar tablas directamente en PostgreSQL.

## Flujo obligatorio para cambios de schema

```bash
cd backend

# 1. Validar el schema antes de cualquier acción
npx prisma validate

# 2. Crear la migración (nombre descriptivo en snake_case)
npx prisma migrate dev --name add_vehicle_color_field

# 3. Regenerar el cliente Prisma
npx prisma generate
```

## Convenciones para nombrar migraciones

Usar snake_case, describir exactamente qué cambia:

```
add_vehicle_color_field
remove_deprecated_notes_column
add_index_expenses_vehicle_id
create_settings_table
rename_sale_price_to_final_price
```

## Agregar un campo nuevo

```prisma
// En schema.prisma
model Vehicle {
  // ...campos existentes...
  color String?   // ← nuevo campo opcional
}
```

```bash
npx prisma validate
npx prisma migrate dev --name add_vehicle_color_field
npx prisma generate
```

## Agregar una relación nueva

```prisma
model Vehicle {
  id       String  @id @default(cuid())
  photos   Photo[]  // ← nueva relación
}

model Photo {
  id        String  @id @default(cuid())
  vehicleId String
  vehicle   Vehicle @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
}
```

Siempre usar `onDelete: Cascade` en relaciones hijas de Vehicle.

## Enums existentes — no modificar sin migración

```
VehicleStage: NEGOCIANDO | COMPRADO | ALISTAMIENTO | PUBLICADO | DISPONIBLE | VENDIDO
ExpenseCategory: MECANICA | ESTETICA | IMPUESTOS | TRAMITE | COMISION | PARQUEADERO | PUBLICIDAD | COMBUSTIBLE | OTRO
DocumentType: TARJETA_PROPIEDAD | SOAT | TECNOMECANICA | PERITAJE | CERTIFICADO_TRADICION | CONTRATO | FOTO_VEHICULO | OTRO
Role: ADMIN | VIEWER
```

Para agregar un valor a un enum, crear migración con `add_<valor>_to_<enum>`.

## Backup antes de migrar en producción

```bash
# Hacer backup antes de cualquier migración en producción
pg_dump -U autocontrol autocontrol_db > backup_$(date +%Y%m%d_%H%M%S).sql

# Luego aplicar la migración
npx prisma migrate deploy
```

## Consultas directas permitidas (solo desarrollo/debug)

```bash
# Ver tablas
psql -U autocontrol -d autocontrol_db -c "\dt"

# Prisma Studio (UI visual)
npx prisma studio
```
