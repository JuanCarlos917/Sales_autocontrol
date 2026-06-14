const userService = require('../services/userService');

const list = async (req, res, next) => {
  try { res.json(await userService.list()); } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try { res.status(201).json(await userService.create(req.body)); } catch (err) { next(err); }
};

const updateRole = async (req, res, next) => {
  try { res.json(await userService.updateRole(req.params.id, req.body.role, req.user.id)); } catch (err) { next(err); }
};

const setStatus = async (req, res, next) => {
  try { res.json(await userService.setStatus(req.params.id, req.body.isActive, req.user.id)); } catch (err) { next(err); }
};

const resetCredentials = async (req, res, next) => {
  try { res.json(await userService.resetCredentials(req.params.id, req.body)); } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try { res.json(await userService.remove(req.params.id, req.user.id)); } catch (err) { next(err); }
};

module.exports = { list, create, updateRole, setStatus, resetCredentials, remove };
