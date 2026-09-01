'use strict';

const express = require('express');
const controller = require('./users.controller');
const { requireAuth, requireStaff } = require('../../middleware/auth');

const router = express.Router();

// Any authenticated user can read and update their own profile.
router.get('/me', requireAuth, controller.me);
router.put('/me', requireAuth, controller.updateMe);

// Staff only. A manager sees their own hostel's students; a super admin sees
// all of them. The scope is applied in the service, not here.
router.get('/', requireAuth, requireStaff, controller.listStudents);

module.exports = router;
