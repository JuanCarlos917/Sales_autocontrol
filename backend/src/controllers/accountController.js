// ═══════════════════════════════════════════════════════════════
// Controller — Account (Cuentas de tesorería)
// ═══════════════════════════════════════════════════════════════

const accountService = require('../services/accountService');

const getAll = async (req, res, next) => {
  try {
    const { isActive } = req.query;
    const accounts = await accountService.findAll({
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
    });
    res.json(accounts);
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const account = await accountService.findById(req.params.id);
    res.json(account);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const account = await accountService.create(req.body, req.user.id);
    res.status(201).json(account);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const account = await accountService.update(req.params.id, req.body);
    res.json(account);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await accountService.delete(req.params.id);
    res.json({ message: 'Cuenta eliminada' });
  } catch (err) { next(err); }
};

const getTotalBalance = async (req, res, next) => {
  try {
    const total = await accountService.getTotalBalance();
    res.json({ totalBalance: total });
  } catch (err) { next(err); }
};

module.exports = { getAll, getOne, create, update, remove, getTotalBalance };
