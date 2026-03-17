// ═══════════════════════════════════════════════════════════════
// Controller — Auth
// ═══════════════════════════════════════════════════════════════

const authService = require('../services/authService');

const register = async (req, res, next) => {
  try {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

const login = async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    res.json(result);
  } catch (err) { next(err); }
};

const pinLogin = async (req, res, next) => {
  try {
    const result = await authService.pinLogin(req.body);
    res.json(result);
  } catch (err) { next(err); }
};

const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const result = await authService.refreshToken(refreshToken);
    res.json(result);
  } catch (err) { next(err); }
};

const changePassword = async (req, res, next) => {
  try {
    await authService.changePassword(req.user.id, req.body);
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) { next(err); }
};

const logout = async (req, res, next) => {
  try {
    await authService.logout(req.body.refreshToken);
    res.json({ message: 'Sesión cerrada' });
  } catch (err) { next(err); }
};

const me = async (req, res) => {
  res.json({ user: req.user });
};

module.exports = { register, login, pinLogin, refreshToken, changePassword, logout, me };
