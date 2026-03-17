// ═══════════════════════════════════════════════════════════════
// Controller — Vehicle
// ═══════════════════════════════════════════════════════════════

const vehicleService = require('../services/vehicleService');

const getAll = async (req, res, next) => {
  try {
    const { stage, search } = req.query;
    const vehicles = await vehicleService.findAll(req.user.id, { stage, search });
    res.json(vehicles);
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const vehicle = await vehicleService.findById(req.params.id, req.user.id);
    res.json(vehicle);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const vehicle = await vehicleService.create(req.body, req.user.id);
    res.status(201).json(vehicle);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const vehicle = await vehicleService.update(req.params.id, req.body, req.user.id);
    res.json(vehicle);
  } catch (err) { next(err); }
};

const updateStage = async (req, res, next) => {
  try {
    const vehicle = await vehicleService.updateStage(req.params.id, req.body.stage, req.user.id);
    res.json(vehicle);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await vehicleService.delete(req.params.id, req.user.id);
    res.json({ message: 'Vehículo eliminado' });
  } catch (err) { next(err); }
};

module.exports = { getAll, getOne, create, update, updateStage, remove };
