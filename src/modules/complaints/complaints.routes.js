'use strict';

const express = require('express');
const controller = require('./complaints.controller');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { uploadImage } = require('../../middleware/upload');
const { ROLES } = require('../../config/constants');

const router = express.Router();

// Students create and manage their own complaints.
router.post('/', requireAuth, requireRole(ROLES.STUDENT), uploadImage, controller.create);
router.get('/mine', requireAuth, requireRole(ROLES.STUDENT), controller.listMine);
router.put('/:id', requireAuth, requireRole(ROLES.STUDENT), uploadImage, controller.update);
router.delete('/:id', requireAuth, requireRole(ROLES.STUDENT), controller.remove);

// Readable by the owner or an admin (ownership enforced in the service).
router.get('/:id', requireAuth, controller.getOne);

module.exports = router;
