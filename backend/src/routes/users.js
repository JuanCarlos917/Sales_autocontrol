const express = require('express');
const ctrl = require('../controllers/userController');
const { authorize } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

// Todo el módulo es exclusivo de ADMIN (authenticate ya se aplicó globalmente).
router.use(authorize('ADMIN'));

router.get('/', ctrl.list);
router.post('/', validate(schemas.userCreate), ctrl.create);
router.patch('/:id/role', validate(schemas.userRole), ctrl.updateRole);
router.patch('/:id/status', validate(schemas.userStatus), ctrl.setStatus);
router.patch('/:id/password', validate(schemas.userPassword), ctrl.resetCredentials);
router.delete('/:id', ctrl.remove);

module.exports = router;
