const { Router } = require('express');
const ctrl = require('../controllers/dashboardController');

const router = Router();


router.get('/overview', ctrl.getOverview);
router.post('/projection', ctrl.getProjection);

module.exports = router;
