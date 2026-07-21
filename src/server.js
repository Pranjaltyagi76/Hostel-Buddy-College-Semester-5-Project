'use strict';

// Application entry point: prepare the database, then start listening.
const app = require('./app');
const config = require('./config/env');
const { initSchema } = require('./db');
const { seedAdmin } = require('./db/seedAdmin');

function start() {
  // Ensure tables and indexes exist before serving traffic.
  initSchema();
  console.log(`[db] schema ready at ${config.dbPath}`);

  // Ensure the administrator account exists.
  seedAdmin();

  app.listen(config.port, () => {
    console.log(`[server] Hostel Buddy running at http://localhost:${config.port}`);
    console.log(`[server] environment: ${config.env}`);
  });
}

start();
