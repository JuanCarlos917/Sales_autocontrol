const { Router } = require('express');
const ctrl = require('../controllers/dashboardController');

const router = Router();


router.get('/overview', ctrl.getOverview);
router.get('/pipeline-target', ctrl.getPipelineTarget);
router.post('/projection', ctrl.getProjection);

module.exports = router;
