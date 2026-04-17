// ═══════════════════════════════════════════════════════════════
// Controller — Alerts
// ═══════════════════════════════════════════════════════════════

const alertService = require('../services/alertService');

const getAllAlerts = async (req, res, next) => {
  try {
    const alerts = await alertService.getAllAlerts();
    res.json(alerts);
  } catch (err) {
    next(err);
  }
};

const getAlertsSummary = async (req, res, next) => {
  try {
    const summary = await alertService.getAlertsSummary();
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllAlerts, getAlertsSummary };
