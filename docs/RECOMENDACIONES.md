# AutoControl — Recomendaciones de Infraestructura e Innovación
## Análisis de Puntos Ciegos para Operación Real

---

## A. PUNTOS CIEGOS FINANCIEROS (Lo que la app aún no cubre)

### 1. Depreciación por Tiempo vs Mercado
Tu modelo actual mide cuánto gastaste, pero no cuánto se deprecia el carro mientras lo tienes.
Un carro que compraste en $30M hace 60 días puede valer $28M en el mercado hoy.
**Feature sugerido**: Campo "Valor de mercado estimado" que actualizas periódicamente.
La app debería calcular: Ganancia Real = Venta - Costo Real - Depreciación de Mercado.

### 2. Costo de Oportunidad del Capital
Si tienes $30M inmovilizados en un carro por 45 días, ese dinero podría estar en un CDT
al 12% EA. Eso es ~$440K que "perdiste" por tenerlo en un carro parado.
**Feature sugerido**: Mostrar en el dashboard el costo de oportunidad vs CDT/rentabilidad
alternativa configurable.

### 3. Flujo de Caja Proyectado
No basta saber cuánto ganaste. Necesitas saber cuándo vas a tener plata disponible.
**Feature sugerido**: Vista de timeline que muestre:
- Cuándo vencen pagos pendientes (gastos no pagados)
- Capital comprometido vs disponible
- Proyección de recuperación si vendes en X días

### 4. Registro de Cruces Completo
Cuando recibes un carro como parte de pago, ese carro se convierte en un nuevo activo.
El sistema debería crear automáticamente un nuevo vehículo en etapa "Comprado"
con el valor asignado como precio de compra, vinculado al negocio original.

### 5. Historial de Precios de Mercado
Para saber si estás comprando bien, necesitas contexto.
**Feature sugerido**: Registrar el precio promedio de mercado de cada marca/modelo/año
cuando lo compras. Así puedes medir: "¿Compré por debajo del mercado?"

---

## B. PUNTOS CIEGOS OPERATIVOS

### 1. Historial de Actividad / Auditoría
Cada acción importante debería quedar registrada con timestamp:
- Quién movió el carro de etapa
- Quién registró un gasto
- Cuándo se cambió un precio
Esto es crítico para control cuando tengas socios o empleados.

### 2. Recordatorios de Documentos
SOAT y Tecnomecánica tienen fecha de vencimiento.
**Feature sugerido**: Campo de fecha de vencimiento en documentos con alertas
automáticas tipo "El SOAT del ABC123 vence en 15 días".

### 3. Contactos de Compradores/Vendedores
No es un CRM completo, pero sí necesitas saber:
- A quién le compraste el carro (nombre, teléfono)
- A quién se lo vendiste
Para temas legales, garantías informales, y red de contactos.

### 4. Registro de Comisionistas
Si tienes una red de comisionistas, necesitas:
- Quién refirió cada venta
- Cuánto se le pagó
- Track record por comisionista (quién vende más, más rápido)

---

## C. INFRAESTRUCTURA PARA PRODUCCIÓN

### 1. Hosting Recomendado (Económico y Estable)
Para un proyecto como este, tu mejor opción es un VPS:

| Proveedor      | Plan          | Precio/mes | RAM  | Almacenamiento |
|---------------|---------------|------------|------|----------------|
| DigitalOcean  | Droplet Basic | $12 USD    | 2GB  | 50GB SSD       |
| Hetzner       | CX22          | €4.50 EUR  | 4GB  | 40GB SSD       |
| Contabo       | Cloud VPS S   | €6 EUR     | 8GB  | 200GB SSD      |

**Mi recomendación**: Hetzner CX22 — la mejor relación precio/rendimiento.
Para empezar con 1-3 carros simultáneos, 2GB RAM es más que suficiente.

### 2. Dominio y SSL
- Compra un dominio: autocontrol.co o tuempresa.co (~$10/año en Namecheap)
- SSL gratis con Let's Encrypt + Certbot (ya configurado en el Nginx)
- Cloudflare como DNS y CDN (gratis) para protección DDoS

### 3. Backups Automáticos
El script backup.sh que incluí se programa con cron:
```
0 3 * * * /ruta/autocontrol-project/scripts/backup.sh
```
Esto hace backup de la DB cada noche a las 3am.
Adicionalmente: configura backup del VPS completo en el proveedor (Hetzner lo ofrece por €1/mes).

### 4. Monitoreo
- UptimeRobot (gratis): te avisa si la app se cae
- Endpoint /api/health ya incluido para health checks

---

## D. SEGURIDAD AVANZADA

### 1. Implementar en Futuras Versiones
- [ ] Two-Factor Authentication (2FA) con código TOTP
- [ ] Logs de acceso con IP y dispositivo
- [ ] Bloqueo de cuenta tras 5 intentos fallidos
- [ ] Sesiones activas visibles (poder cerrar sesiones remotas)
- [ ] Encriptación de datos sensibles en la DB (precios, ganancias)

### 2. Ya Implementado
- [x] JWT con refresh tokens rotativos
- [x] Bcrypt para passwords (12 rounds)
- [x] Rate limiting diferenciado (auth más estricto)
- [x] Helmet security headers
- [x] Validación Joi en todos los endpoints
- [x] Nginx con HSTS, CSP, XSS protection
- [x] Ownership verification en cada operación

---

## E. ROADMAP SUGERIDO

### Fase 1 (Ahora) — MVP Operativo
- Desplegar el proyecto actual en VPS
- Crear usuario admin real con password seguro
- Registrar los vehículos actuales
- Usar 2 semanas como prueba operativa

### Fase 2 (Mes 1) — Refinamiento
- Agregar historial de actividad/auditoría
- Recordatorios de documentos por vencer
- Contactos mínimos de comprador/vendedor
- PWA (Progressive Web App) para instalar en el celular

### Fase 3 (Mes 2) — Inteligencia
- Dashboard de costo de oportunidad
- Flujo de caja proyectado
- Tracking de comisionistas con métricas
- Vinculación automática de cruces de vehículos

### Fase 4 (Mes 3+) — Escalamiento
- Multi-usuario (si entran socios o vendedores)
- Roles diferenciados (Admin, Vendedor, Visor)
- Reportes PDF mensuales automáticos
- Integración con WhatsApp Business API para notificaciones
- API pública si quieres conectar con otras herramientas

---

## F. MODELO DE NEGOCIO — FÓRMULA DE RENTABILIDAD

Para que el negocio crezca, tu fórmula debería ser:

### Ganancia Mínima Objetivo por Carro:
```
Ganancia Mínima = Gastos Fijos Mensuales / Carros Vendidos al Mes + Margen Deseado

Ejemplo actual:
  Gastos fijos: $800,000/mes
  Carros vendidos: ~2/mes
  Gasto fijo por carro: $400,000
  Margen mínimo deseado: $2,000,000

  → No compres un carro si la ganancia proyectada < $2,400,000
```

### Regla de Rotación:
```
ROI Anualizado = (Ganancia Neta / Costo Real) × (365 / Días en Inventario)

Un carro con 10% ROI en 15 días = 243% ROI anualizado
Un carro con 15% ROI en 60 días = 91% ROI anualizado

→ Es mejor ganar menos pero más rápido
```

### Punto de Equilibrio Mensual:
```
Punto Equilibrio = Gastos Fijos + (Gastos Variables Promedio × Carros)
                 = $800,000 + ($1,500,000 × 2)
                 = $3,800,000/mes en costos operativos

→ Necesitas vender mínimo $3,800,000 en ganancia bruta para no perder
```

El dashboard ya calcula todo esto por vehículo.
El feature que falta es mostrarlo consolidado como "meta mensual".
