'use strict';

const express = require('express');
const controller = require('./hostels.controller');
const { requireAuth, requireSuperAdmin } = require('../../middleware/auth');

const router = express.Router();

// Public: the registration form must offer a hostel to choose before the user
// has an account, so this cannot sit behind authentication. Hostel names and
// locations are not sensitive.
router.get('/', controller.list);

// Super admin only. A manager is scoped BY a hostel, so letting them edit
// hostels would let them redraw their own authority.
router.post('/', requireAuth, requireSuperAdmin, controller.create);
router.put('/:id', requireAuth, requireSuperAdmin, controller.update);
router.delete('/:id', requireAuth, requireSuperAdmin, controller.remove);

module.exports = router;
