const debtService = require('../services/debtService');

const create = async (req, res, next) => {
  try { res.status(201).json(await debtService.create(req.body, req.user.id)); }
  catch (err) { next(err); }
};

const list = async (req, res, next) => {
  try { res.json(await debtService.list({ status: req.query.status || undefined })); }
  catch (err) { next(err); }
};

const findById = async (req, res, next) => {
  try { res.json(await debtService.findById(req.params.id)); }
  catch (err) { next(err); }
};

const addPayment = async (req, res, next) => {
  try { res.status(201).json(await debtService.addPayment(req.params.id, req.body, req.user.id)); }
  catch (err) { next(err); }
};

const reconcileCandidates = async (req, res, next) => {
  try { res.json(await debtService.reconcileCandidates({ search: req.query.search || undefined })); }
  catch (err) { next(err); }
};

const reconcile = async (req, res, next) => {
  try { res.status(201).json(await debtService.reconcile(req.params.id, req.body, req.user.id)); }
  catch (err) { next(err); }
};

const cancel = async (req, res, next) => {
  try { res.json(await debtService.cancel(req.params.id, req.user.id)); }
  catch (err) { next(err); }
};

module.exports = { create, list, findById, addPayment, reconcileCandidates, reconcile, cancel };
