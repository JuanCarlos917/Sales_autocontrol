// ═══════════════════════════════════════════════════════════════
// Service — User Management (admin-only)
// ═══════════════════════════════════════════════════════════════

const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

// Campos seguros: NUNCA exponer password ni pin.
const SAFE_SELECT = {
  id: true, email: true, name: true, role: true,
  isActive: true, lastLogin: true, createdAt: true,
};

async function getTargetOr404(id) {
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new AppError('Usuario no encontrado', 404);
  return target;
}

// Lanza si el target es el único ADMIN activo (para degradar/desactivar/borrar).
async function assertNotLastActiveAdmin(target) {
  if (target.role === 'ADMIN' && target.isActive) {
    const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
    if (activeAdmins <= 1) {
      throw new AppError('Debe quedar al menos un ADMIN activo', 403);
    }
  }
}

class UserService {
  async list() {
    return prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: SAFE_SELECT });
  }

  async create({ email, password, name, role, pin }) {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new AppError('El email ya está registrado', 409);
    return prisma.user.create({
      data: {
        email,
        name: name || null,
        role,
        password: await bcrypt.hash(password, 12),
        pin: pin ? await bcrypt.hash(pin, 10) : null,
      },
      select: SAFE_SELECT,
    });
  }

  async updateRole(id, role, actorId) {
    if (id === actorId) throw new AppError('No podés cambiar tu propio rol', 403);
    const target = await getTargetOr404(id);
    if (role !== 'ADMIN') await assertNotLastActiveAdmin(target); // degradar al último ADMIN
    return prisma.user.update({ where: { id }, data: { role }, select: SAFE_SELECT });
  }

  async setStatus(id, isActive, actorId) {
    if (id === actorId) throw new AppError('No podés cambiar tu propio estado', 403);
    const target = await getTargetOr404(id);
    if (isActive === false) await assertNotLastActiveAdmin(target); // desactivar al último ADMIN
    return prisma.user.update({ where: { id }, data: { isActive }, select: SAFE_SELECT });
  }

  async resetCredentials(id, { password, pin }) {
    await getTargetOr404(id);
    const data = {};
    if (password) data.password = await bcrypt.hash(password, 12);
    if (pin) data.pin = await bcrypt.hash(pin, 10);
    if (Object.keys(data).length === 0) throw new AppError('Debe enviar al menos password o pin', 400);
    return prisma.user.update({ where: { id }, data, select: SAFE_SELECT });
  }

  async remove(id, actorId) {
    if (id === actorId) throw new AppError('No podés borrar tu propio usuario', 403);
    const target = await getTargetOr404(id);
    await assertNotLastActiveAdmin(target);

    // Integridad/auditoría: bloquear borrado si tiene datos asociados.
    // FKs Restrict sobre User: vehicles + los 3 audit logs. createdBy es string (no FK)
    // pero se incluye para preservar trazabilidad.
    const [vehicles, txs, eAudit, vAudit, tAudit] = await Promise.all([
      prisma.vehicle.count({ where: { userId: id } }),
      prisma.transaction.count({ where: { createdBy: id } }),
      prisma.expenseAuditLog.count({ where: { userId: id } }),
      prisma.vehicleAuditLog.count({ where: { userId: id } }),
      prisma.treasuryAuditLog.count({ where: { userId: id } }),
    ]);
    if (vehicles + txs + eAudit + vAudit + tAudit > 0) {
      throw new AppError('El usuario tiene datos asociados; desactivalo en lugar de borrarlo', 409);
    }

    await prisma.user.delete({ where: { id } }); // refresh_tokens cascadean
    return { deleted: true };
  }
}

module.exports = new UserService();
module.exports.SAFE_SELECT = SAFE_SELECT;
