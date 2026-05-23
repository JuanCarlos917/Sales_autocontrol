# Despliegue en producción — AWS (EC2 + S3 + Caddy)

Guía paso a paso para poner AutoControl en AWS:
- **EC2** (`t3.micro`, gratis 12 meses) corriendo todo el stack con Docker Compose.
- **S3** (bucket privado) para los archivos subidos — persisten aunque reinstales el servidor.
- **Caddy** como proxy de borde con **HTTPS automático** (sin certbot ni cron de renovación).

```
Internet ──HTTPS──▶ Caddy (EC2, puertos 80/443)
                      ├─ /api/*     ▶ backend (Node/Express)  ──▶ Postgres (contenedor)
                      ├─ /uploads/* ▶ backend                  ──▶ S3 (URLs prefirmadas)
                      └─ /*         ▶ frontend (SPA estática)
```
Solo Caddy se expone a internet; la DB y el backend viven en la red interna de Docker.

---

## 0. Costos (sé realista)

| Concepto | Primer año (Free Tier) | Después del año |
|---|---|---|
| EC2 `t3.micro` (750 h/mes) | **$0** | ~$7.5/mes |
| EBS 30 GB gp3 | **$0** (30 GB incluidos) | ~$2.4/mes |
| IPv4 pública (Elastic IP) | ~$3.6/mes ⚠️ *(se cobra desde 2024 aun en Free Tier)* | ~$3.6/mes |
| S3 (pocos GB) | **$0** (5 GB incluidos) | ~$0.10–0.50/mes |
| Transferencia de salida | 100 GB/mes gratis | 100 GB/mes gratis |
| **Total aprox.** | **~$3.6/mes** | **~$14/mes** |

> Si 1 GB de RAM se queda corto, sube a `t3.small` (2 GB, ~$15/mes, **no** es Free Tier).
> Esta guía configura **2 GB de swap** para que `t3.micro` aguante esta app de bajo tráfico.

**Para no llevarte sustos:** activa una alerta de presupuesto en *AWS Billing → Budgets* (ej. aviso al superar $5).

---

## 1. Prerrequisitos
- Cuenta AWS (requiere tarjeta de crédito internacional). **No uses la cuenta root** para el día a día.
- Un dominio (ej. `autocontrol.co`, ~$10/año en Namecheap o Cloudflare).
- El PR de despliegue mergeado a `main` (o despliega desde la rama que prefieras).

---

## 2. Crear el bucket S3 + usuario IAM (uploads)

### 2.1 Bucket
1. **S3 → Create bucket**.
2. Nombre único global, ej. `autocontrol-uploads-<algo>`. Región: **us-east-1** (la misma que el EC2).
3. **Block all public access: ACTIVADO** (dejar marcado). Las URLs prefirmadas funcionan sin acceso público.
4. Create bucket.

### 2.2 Usuario IAM con permiso mínimo
1. **IAM → Users → Create user**, ej. `autocontrol-s3`. Sin acceso a consola.
2. **Attach policies → Create inline policy → JSON**, pega (cambia el nombre del bucket):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AutoControlUploads",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::autocontrol-uploads-<algo>/*"
    }
  ]
}
```
3. Crea el usuario → **Security credentials → Create access key** (tipo *Application running outside AWS*).
   Guarda `Access key ID` y `Secret access key` (los pones en `.env` más adelante).

> *(Opcional)* Si el frontend descarga archivos vía `fetch()` y no por `<img>`/enlace directo,
> añade CORS al bucket (**Permissions → CORS**) permitiendo tu dominio en `AllowedOrigins`.

---

## 3. Lanzar la instancia EC2

1. **EC2 → Launch instance**.
2. **AMI:** Ubuntu Server 24.04 LTS (Free Tier eligible).
3. **Tipo:** `t3.micro` (Free Tier).
4. **Key pair:** crea uno nuevo, descarga el `.pem` y guárdalo bien.
5. **Network / Security group** (inbound):
   | Tipo | Puerto | Origen |
   |---|---|---|
   | SSH | 22 | **My IP** (solo tu IP) |
   | HTTP | 80 | 0.0.0.0/0 |
   | HTTPS | 443 | 0.0.0.0/0 |
6. **Storage:** 30 GB gp3.
7. Launch.

### 3.1 IP fija (Elastic IP)
1. **EC2 → Elastic IPs → Allocate**.
2. **Associate** a tu instancia. Anota la IP (es la que usará tu dominio).

---

## 4. DNS: apuntar el dominio a la IP

En tu proveedor de DNS (recomiendo **Cloudflare**, gratis):
- Registro **A**: `autocontrol.co` → *Elastic IP*.
- (Opcional) Registro **A**: `www` → misma IP.
- Para la emisión del certificado, empieza con la nube **gris** ("DNS only") en Cloudflare.

> ⚠️ El DNS debe propagarse y resolver a la IP **antes** de levantar el stack, o Caddy no podrá
> emitir el certificado. Verifica con `dig autocontrol.co +short` o `nslookup`.

---

## 5. Preparar el servidor

Conéctate (en AWS el usuario por defecto de Ubuntu es `ubuntu`):
```bash
chmod 400 tu-key.pem
ssh -i tu-key.pem ubuntu@<ELASTIC_IP>
```

Dentro del servidor:
```bash
# Sistema + git
sudo apt update && sudo apt -y upgrade && sudo apt -y install git

# Docker + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Swap de 2 GB (clave en t3.micro de 1 GB)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Firewall del SO (además del Security Group de AWS)
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
```
Cierra sesión y vuelve a entrar (`exit` y `ssh ...`) para que aplique el grupo `docker`.

> Recomendado: en `/etc/ssh/sshd_config` poner `PasswordAuthentication no` (solo llave) y `sudo systemctl restart ssh`.

---

## 6. Traer el proyecto y configurar `.env`

```bash
git clone <URL_DE_TU_REPO> autocontrol-project
cd autocontrol-project
git checkout main          # o la rama que vayas a desplegar
cp .env.example .env
nano .env
```

Rellena `.env` con **valores reales**. Genera los secretos con:
```bash
openssl rand -hex 32      # úsalo para JWT_SECRET y otra vez (distinto) para JWT_REFRESH_SECRET
openssl rand -hex 16      # úsalo para DB_PASSWORD
```

Mínimo a definir:
```bash
DB_PASSWORD=<openssl rand -hex 16>
JWT_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<otro openssl rand -hex 32>
ADMIN_EMAIL=admin@autocontrol.co
ADMIN_PASSWORD=<clave fuerte 8+>
ADMIN_PIN=<6+ dígitos>
CORS_ORIGIN=https://autocontrol.co
VITE_API_URL=/api

# TLS / Caddy
DOMAIN=autocontrol.co
ACME_EMAIL=tu-correo@ejemplo.com

# Uploads en S3
S3_BUCKET=autocontrol-uploads-<algo>
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=<de la sección 2.2>
AWS_SECRET_ACCESS_KEY=<de la sección 2.2>
```

> El backend hace **fail-fast**: si falta o es débil algún secreto obligatorio, `docker compose`
> aborta con un mensaje claro en vez de arrancar inseguro.

---

## 7. Desplegar

```bash
./scripts/deploy.sh
```
Esto: construye imágenes → levanta servicios → espera a que el backend esté **sano** →
aplica migraciones → crea el admin. **Caddy emite el certificado HTTPS automáticamente**
en el primer arranque (por eso el DNS debía estar listo antes).

Si algo falla, los logs son tu amigo:
```bash
docker compose logs -f caddy      # emisión del certificado / TLS
docker compose logs -f backend    # fail-fast por env, errores de app
docker compose ps                 # estado y health de cada servicio
```

---

## 8. Verificación post-despliegue
```bash
curl -I https://autocontrol.co/api/health     # debe responder 200
```
En el navegador (`https://autocontrol.co`):
- [ ] El candado de HTTPS es válido.
- [ ] Login con email y con PIN funciona.
- [ ] Crear vehículo → registrar compra con pago → **subir un documento**.
- [ ] El documento se ve (URL prefirmada de S3) y **sigue visible tras un redeploy**.
- [ ] Un usuario con rol `VIEWER` ve "Solo lectura" y no puede escribir.

---

## 9. Backups + restore

```bash
crontab -e
# Backup diario 3am (RUTA ABSOLUTA obligatoria):
0 3 * * * /home/ubuntu/autocontrol-project/scripts/backup.sh
```
- **Prueba el restore una vez** (un backup sin restore probado no es un backup):
  ```bash
  ./scripts/backup.sh
  ./scripts/restore.sh backups/autocontrol_backup_<fecha>.sql.gz
  ```
- **Snapshots de EBS** (respaldo de todo el disco): EC2 → *Lifecycle Manager* → política diaria,
  o snapshots manuales. Así recuperas el servidor completo ante un desastre.
- S3 ya es durable; opcionalmente activa *Versioning* en el bucket.

---

## 10. Monitoreo
- **UptimeRobot** (gratis): monitorea `https://autocontrol.co/api/health` y te avisa si se cae.
- **Sentry** (opcional): pon `SENTRY_DSN` en `.env` y redeploy para recibir los errores 5xx.

---

## 11. Operación continua

```bash
# Actualizar a la última versión
cd ~/autocontrol-project
git pull
./scripts/deploy.sh

# Ver logs / reiniciar
docker compose logs -f
docker compose restart backend
```
Caddy **renueva el certificado solo**: no hay que hacer nada para el TLS.

---

## 12. Apagar todo para dejar de pagar (teardown)

Si decides bajar el proyecto, para evitar cobros:
1. **EC2 → Instances → Terminate** la instancia.
2. **EC2 → Elastic IPs → Release** la IP (si no la liberas, te siguen cobrando).
3. **EC2 → Volumes / Snapshots:** elimina los que no necesites.
4. **S3:** vacía y elimina el bucket si ya no lo usas.
5. **IAM:** elimina el usuario `autocontrol-s3`.

---

## 13. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| Caddy no saca el certificado | DNS no apunta a la IP, o puerto 80 cerrado | `dig DOMAIN +short`; revisa el Security Group (80/443 abiertos); `docker compose logs caddy` |
| Backend en reinicio constante | Falta/ débil un secreto (`.env`) | `docker compose logs backend` muestra qué variable falta |
| La app se cuelga / OOM | 1 GB de RAM corto | Confirma el swap (`free -h`); considera `t3.small` |
| Documentos no cargan | Credenciales/política S3 | Revisa `S3_*` y que la policy IAM apunte al bucket correcto |
| Cobro inesperado | IPv4 / instancia encendida | Revisa *Billing*; aplica el teardown de la sección 12 |

---

> Referencia general (independiente de proveedor): [DEPLOYMENT.md](DEPLOYMENT.md).
