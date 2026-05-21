// ═══════════════════════════════════════════════════════════════
// Middleware — File Upload (Multer)
// ═══════════════════════════════════════════════════════════════

const multer = require('multer');
const config = require('../config');
const { buildMulterStorage } = require('../utils/storage');

// Disco local o memoria (para S3), según la configuración de almacenamiento.
const storage = buildMulterStorage();

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo JPG, PNG, WebP y PDF.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxSize },
});

module.exports = upload;
