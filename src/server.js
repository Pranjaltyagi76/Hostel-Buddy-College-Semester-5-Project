'use strict';

// Application entry point: prepare the database, then start listening.
const app = require('./app');
const config = require('./config/env');
const { prepareDatabase } = require('./db/prepare');

async function start() {
  await prepareDatabase();

  app.listen(config.port, () => {
    console.log(`[server] Hostel Buddy running at http://localhost:${config.port}`);
    console.log(`[server] environment: ${config.env}`);
  });
}

// Vercel imports this module and invokes the exported Express application.
// Local execution still starts the regular long-running HTTP server.
if (require.main === module) start().catch((err) => {
  console.error('[server] startup failed:', err.message);
  process.exitCode = 1;
});

module.exports = app;
