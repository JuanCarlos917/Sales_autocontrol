// ═══════════════════════════════════════════════════════════════
// Controller — Document
// ═══════════════════════════════════════════════════════════════

const documentService = require('../services/documentService');

const getByVehicle = async (req, res, next) => {
  try {
    const docs = await documentService.findByVehicle(req.params.vehicleId, req.user.id);
    res.json(docs);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const doc = await documentService.create(
      { vehicleId: req.params.vehicleId, type: req.body.type, notes: req.body.notes },
      req.file,
      req.user.id
    );
    res.status(201).json(doc);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await documentService.delete(req.params.id, req.user.id);
    res.json({ message: 'Documento eliminado' });
  } catch (err) { next(err); }
};

module.exports = { getByVehicle, create, remove };
