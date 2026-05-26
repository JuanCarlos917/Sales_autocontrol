// ═══════════════════════════════════════════════════════════════
// Service — Document (Gestión de archivos y fotos)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const storage = require('../utils/storage');
const aiExtractor = require('../utils/aiExtractor');

/** Agrega `url` (servible por el navegador) a un documento. */
async function withUrl(doc) {
  return { ...doc, url: await storage.getUrl(doc.filepath) };
}

class DocumentService {
  async findByVehicle(vehicleId, userId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
    if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

    const docs = await prisma.document.findMany({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(docs.map(withUrl));
  }

  async create({ vehicleId, type, notes }, file, userId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
    if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

    if (!file) throw new AppError('Archivo requerido', 400);

    // Persiste en disco o S3 y devuelve el filepath a guardar.
    const filepath = await storage.persistUpload(file, vehicleId);

    // Extracción IA para tarjeta de propiedad — opt-in vía ANTHROPIC_API_KEY.
    // Una falla aquí NUNCA debe romper el upload; solo se queda sin sugerencias.
    let extractedData = null;
    if (type === 'TARJETA_PROPIEDAD' && aiExtractor.isExtractionEnabled()) {
      try {
        extractedData = await aiExtractor.extractTarjetaPropiedad(file);
      } catch (err) {
        console.error('[aiExtractor] extracción de tarjeta falló:', err.message);
      }
    }

    const doc = await prisma.document.create({
      data: {
        vehicleId,
        type,
        notes,
        filename: file.originalname,
        filepath,
        mimetype: file.mimetype,
        size: file.size,
        // Prisma 4 con Json? rechaza `null` literal; `undefined` omite el campo
        // y la columna nullable queda como NULL en la DB.
        extractedData: extractedData ?? undefined,
      },
    });
    return withUrl(doc);
  }

  async delete(id, userId) {
    const doc = await prisma.document.findFirst({
      where: { id },
      include: { vehicle: { select: { userId: true } } },
    });
    if (!doc || doc.vehicle.userId !== userId) throw new AppError('Documento no encontrado', 404);

    await storage.deleteFile(doc.filepath);
    await prisma.document.delete({ where: { id } });
    return { deleted: true };
  }
}

module.exports = new DocumentService();
