'use strict';

const express = require('express');
const controller = require('./users.controller');
const { requireAuth, requireStaff, requireSuperAdmin } = require('../../middleware/auth');

const router = express.Router();

// Any authenticated user can read and update their own profile.
router.get('/me', requireAuth, controller.me);
router.put('/me', requireAuth, controller.updateMe);

// Manager accounts are provisioned by the super admin, never self-registered.
// Declared before "/" so the literal path matches first.
router.get('/managers', requireAuth, requireSuperAdmin, controller.listManagers);
router.post('/managers', requireAuth, requireSuperAdmin, controller.createManager);

// Staff only. A manager sees their own hostel's students; a super admin sees
// all of them. The scope is applied in the service, not here.
router.get('/', requireAuth, requireStaff, controller.listStudents);

module.exports = router;
