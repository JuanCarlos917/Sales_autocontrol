// ═══════════════════════════════════════════════════════════════
// Service — Auth (Business logic para autenticación)
// ═══════════════════════════════════════════════════════════════

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');

class AuthService {
  /**
   * Registrar nuevo usuario
   */
  async register({ email, password, name, pin }) {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new AppError('El email ya está registrado', 409);

    const hashedPassword = await bcrypt.hash(password, 12);
    const hashedPin = pin ? await bcrypt.hash(pin, 10) : null;

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name, pin: hashedPin },
      select: { id: true, email: true, name: true, role: true },
    });

    const tokens = await this._generateTokens(user.id);
    return { user, ...tokens };
  }

  /**
   * Login con email y password
   */
  async login({ email, password }) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) throw new AppError('Credenciales inválidas', 401);

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) throw new AppError('Credenciales inválidas', 401);

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    const tokens = await this._generateTokens(user.id);
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...tokens,
    };
  }

  /**
   * Login rápido con PIN
   */
  async pinLogin({ pin, email }) {
    const where = email ? { email } : {};
    const users = email
      ? [await prisma.user.findUnique({ where: { email } })]
      : await prisma.user.findMany({ where: { isActive: true, pin: { not: null } } });

    for (const user of users) {
      if (!user || !user.pin) continue;
      const isValid = await bcrypt.compare(pin, user.pin);
      if (isValid) {
        await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
        const tokens = await this._generateTokens(user.id);
        return {
          user: { id: user.id, email: user.email, name: user.name, role: user.role },
          ...tokens,
        };
      }
    }

    throw new AppError('PIN inválido', 401);
  }

  /**
   * Refrescar access token
   */
  async refreshToken(refreshToken) {
    if (!refreshToken) throw new AppError('Refresh token requerido', 400);

    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { select: { id: true, email: true, name: true, role: true, isActive: true } } },
    });

    if (!stored || stored.expiresAt < new Date() || !stored.user.isActive) {
      if (stored) await prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new AppError('Refresh token inválido o expirado', 401);
    }

    // Rotar refresh token
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const tokens = await this._generateTokens(stored.user.id);

    return { user: stored.user, ...tokens };
  }

  /**
   * Cambiar password
   */
  async changePassword(userId, { currentPassword, newPassword }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('Usuario no encontrado', 404);

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) throw new AppError('Contraseña actual incorrecta', 401);

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } });

    // Invalidar todos los refresh tokens
    await prisma.refreshToken.deleteMany({ where: { userId } });
  }

  /**
   * Logout — invalidar refresh token
   */
  async logout(refreshToken) {
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } }).catch(() => {});
    }
  }

  // ── Helpers internos ──

  async _generateTokens(userId) {
    const accessToken = jwt.sign({ userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

    const refreshToken = jwt.sign({ userId, type: 'refresh' }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });

    // Guardar refresh token en DB
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await prisma.refreshToken.create({ data: { token: refreshToken, userId, expiresAt } });

    // Limpiar tokens expirados
    await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    return { accessToken, refreshToken };
  }
}

module.exports = new AuthService();
