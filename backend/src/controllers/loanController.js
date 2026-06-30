const loanService = require('../services/loanService');

const create = async (req, res, next) => {
  try {
    const result = await loanService.create(req.body, req.user.id);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

const list = async (req, res, next) => {
  try {
    const { status, borrowerId, overdueOnly } = req.query;
    const data = await loanService.list({
      status: status || undefined,
      borrowerId: borrowerId || undefined,
      overdueOnly: overdueOnly === 'true',
    });
    res.json(data);
  } catch (err) { next(err); }
};

const findById = async (req, res, next) => {
  try {
    const data = await loanService.findById(req.params.id);
    res.json(data);
  } catch (err) { next(err); }
};

const addPayment = async (req, res, next) => {
  try {
    const result = await loanService.addPayment(req.params.id, req.body, req.user.id);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

const cancel = async (req, res, next) => {
  try {
    const result = await loanService.cancel(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
};

const reversePayment = async (req, res, next) => {
  try {
    const result = await loanService.reversePayment(req.params.id, req.body.reason, req.user.id);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

module.exports = { create, list, findById, addPayment, cancel, reversePayment };
