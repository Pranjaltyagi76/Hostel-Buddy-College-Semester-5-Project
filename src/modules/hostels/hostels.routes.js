'use strict';

const express = require('express');
const controller = require('./hostels.controller');

const router = express.Router();

// Public: the registration form must offer a hostel to choose before the user
// has an account, so this cannot sit behind authentication. Hostel names and
// locations are not sensitive.
router.get('/', controller.list);

module.exports = router;
