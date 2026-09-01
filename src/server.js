'use strict';

// Application entry point: prepare the database, then start listening.
const app = require('./app');
const config = require('./config/env');
const { initSchema } = require('./db');
const { seedSuperAdmin } = require('./db/seedSuperAdmin');

function start() {
  // Ensure tables and indexes exist before serving traffic.
  initSchema();
  console.log(`[db] schema ready at ${config.dbPath}`);

  // Ensure the single super-administrator account exists.
  seedSuperAdmin();

  app.listen(config.port, () => {
    console.log(`[server] Hostel Buddy running at http://localhost:${config.port}`);
    console.log(`[server] environment: ${config.env}`);
  });
}

start();
