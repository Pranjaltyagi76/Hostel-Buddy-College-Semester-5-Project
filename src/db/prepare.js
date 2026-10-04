'use strict';

// One awaited bootstrap for imported functions and the local server.
const { initSchema } = require('./index');
const { seedSuperAdmin } = require('./seedSuperAdmin');

let ready;

function prepareDatabase() {
  if (!ready) {
    ready = (async () => {
      await initSchema();
      await seedSuperAdmin();
    })().catch((err) => { ready = undefined; throw err; });
  }
  return ready;
}

module.exports = { prepareDatabase };
