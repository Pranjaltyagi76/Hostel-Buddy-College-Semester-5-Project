'use strict';

const express = require('express');
const controller = require('./complaints.controller');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { uploadImage } = require('../../middleware/upload');
const { ROLES } = require('../../config/constants');

const router = express.Router();

// --- Admin: view and manage every complaint ---
// (Listed before "/:id" so the literal paths are matched first.)
router.get('/', requireAuth, requireRole(ROLES.ADMIN), controller.listAll);
router.patch('/:id/status', requireAuth, requireRole(ROLES.ADMIN), controller.updateStatus);

// --- Student: create and manage their own complaints ---
router.post('/', requireAuth, requireRole(ROLES.STUDENT), uploadImage, controller.create);
router.get('/mine', requireAuth, requireRole(ROLES.STUDENT), controller.listMine);
router.put('/:id', requireAuth, requireRole(ROLES.STUDENT), uploadImage, controller.update);
router.delete('/:id', requireAuth, requireRole(ROLES.STUDENT), controller.remove);

// --- Owner or admin: view a single complaint (ownership enforced in service) ---
router.get('/:id', requireAuth, controller.getOne);

module.exports = router;
