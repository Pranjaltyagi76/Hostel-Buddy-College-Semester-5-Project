'use strict';

// Business logic for hostels. Phase C provides only the read side, because
// registration needs a list of hostels to choose from before a user has any
// session at all. Super-admin management of hostels arrives in Phase D.
const hostelsRepo = require('./hostels.repo');

function listAll() {
  return hostelsRepo.listAll();
}

module.exports = { listAll };
