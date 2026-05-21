// ═══════════════════════════════════════════════════════════════
// Almacenamiento de archivos — capa con S3 + fallback a disco local
//
// Sin S3_BUCKET: se usa disco local (comportamiento actual, sin cambios).
// Con S3_BUCKET definido: los archivos se guardan en S3 y se sirven con URL
// prefirmada. Las credenciales se toman del entorno AWS estándar
// (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY o rol IAM).
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');

const S3_PREFIX = 's3://';
const PRESIGN_TTL_SECONDS = 60 * 60; // 1 hora

const s3Settings = {
  bucket: process.env.S3_BUCKET || null,
  region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
};

function isS3Enabled() {
  return !!s3Settings.bucket;
}

// ── Cliente S3 perezoso (solo se carga el SDK si hay bucket) ──
let _s3 = null;
function getS3() {
  if (!_s3) {
    const { S3Client } = require('@aws-sdk/client-s3');
    _s3 = new S3Client({ region: s3Settings.region });
  }
  return _s3;
}

// ── Multer: memoria si hay S3 (necesitamos el buffer), disco si no ──
function buildMulterStorage() {
  if (isS3Enabled()) {
    return multer.memoryStorage();
  }
  if (!fs.existsSync(config.upload.dir)) {
    fs.mkdirSync(config.upload.dir, { recursive: true });
  }
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const vehicleDir = path.join(config.upload.dir, req.params.vehicleId || 'general');
      if (!fs.existsSync(vehicleDir)) fs.mkdirSync(vehicleDir, { recursive: true });
      cb(null, vehicleDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
  });
}

/**
 * Persiste el archivo subido y devuelve el `filepath` a guardar en la BD.
 * - Disco: el archivo ya quedó escrito por multer; devolvemos su ruta.
 * - S3: subimos el buffer y devolvemos una clave con prefijo `s3://`.
 */
async function persistUpload(file, vehicleId) {
  if (!file) return null;
  if (!isS3Enabled()) {
    return file.path; // multer diskStorage ya lo guardó
  }
  const ext = path.extname(file.originalname);
  const key = `vehicles/${vehicleId || 'general'}/${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await getS3().send(new PutObjectCommand({
    Bucket: s3Settings.bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));
  return `${S3_PREFIX}${key}`;
}

/**
 * Devuelve una URL utilizable por el navegador para un `filepath` guardado.
 * - S3: URL prefirmada temporal. - Disco: ruta estática /uploads/...
 */
async function getUrl(filepath) {
  if (!filepath) return null;
  if (filepath.startsWith(S3_PREFIX)) {
    const key = filepath.slice(S3_PREFIX.length);
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: s3Settings.bucket, Key: key }), {
      expiresIn: PRESIGN_TTL_SECONDS,
    });
  }
  // Disco: servir desde el estático /uploads
  const rel = path.relative(config.upload.dir, filepath);
  return `/uploads/${rel.split(path.sep).join('/')}`;
}

/** Borra el archivo del almacenamiento (S3 o disco). No lanza si ya no existe. */
async function deleteFile(filepath) {
  if (!filepath) return;
  if (filepath.startsWith(S3_PREFIX)) {
    const key = filepath.slice(S3_PREFIX.length);
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await getS3().send(new DeleteObjectCommand({ Bucket: s3Settings.bucket, Key: key }));
    return;
  }
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
}

module.exports = { isS3Enabled, buildMulterStorage, persistUpload, getUrl, deleteFile, S3_PREFIX };
