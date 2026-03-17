// ═══════════════════════════════════════════════════════════════
// Service — Document (Gestión de archivos y fotos)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

class DocumentService {
  async findByVehicle(vehicleId, userId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
    if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

    return prisma.document.findMany({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create({ vehicleId, type, notes }, file, userId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
    if (!vehicle) throw new AppError('Vehículo no encontrado', 404);

    if (!file) throw new AppError('Archivo requerido', 400);

    return prisma.document.create({
      data: {
        vehicleId,
        type,
        notes,
        filename: file.originalname,
        filepath: file.path,
        mimetype: file.mimetype,
        size: file.size,
      },
    });
  }

  async delete(id, userId) {
    const doc = await prisma.document.findFirst({
      where: { id },
      include: { vehicle: { select: { userId: true } } },
    });
    if (!doc || doc.vehicle.userId !== userId) throw new AppError('Documento no encontrado', 404);

    // Delete file from disk
    if (fs.existsSync(doc.filepath)) {
      fs.unlinkSync(doc.filepath);
    }

    await prisma.document.delete({ where: { id } });
    return { deleted: true };
  }
}

module.exports = new DocumentService();
