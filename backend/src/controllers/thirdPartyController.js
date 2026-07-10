// ═══════════════════════════════════════════════════════════════
// Controller — ThirdParty (Terceros)
// ═══════════════════════════════════════════════════════════════

const thirdPartyService = require('../services/thirdPartyService');

const getAll = async (req, res, next) => {
  try {
    const { type, isActive, search } = req.query;
    const thirdParties = await thirdPartyService.findAll({
      type,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      search,
    });
    res.json(thirdParties);
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const thirdParty = await thirdPartyService.findById(req.params.id);
    res.json(thirdParty);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const thirdParty = await thirdPartyService.create(req.body);
    res.status(201).json(thirdParty);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const thirdParty = await thirdPartyService.update(req.params.id, req.body);
    res.json(thirdParty);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await thirdPartyService.delete(req.params.id, req.user.id);
    res.json({ message: 'Tercero eliminado' });
  } catch (err) { next(err); }
};

const getStatement = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const statement = await thirdPartyService.getStatement(req.params.id, { startDate, endDate });
    res.json(statement);
  } catch (err) { next(err); }
};

module.exports = { getAll, getOne, create, update, remove, getStatement };
