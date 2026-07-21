'use strict';

// Thin wrapper around jsonwebtoken so the rest of the app never imports it
// directly. Tokens carry the minimum needed to authorize a request.
const jwt = require('jsonwebtoken');
const config = require('../config/env');

function signToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = { signToken, verifyToken };
