'use strict';

// Async statements on local SQLite and remote libSQL. Request-local transaction
// context prevents concurrent requests from sharing a transaction connection.
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('../config/env');
const context = new AsyncLocalStorage();
let local;
let remote;
let localQueue = Promise.resolve();

if (config.databaseUrl) {
  const { createClient } = require('@libsql/client');
  remote = createClient({
    url: config.databaseUrl.replace(/^libsql:/, 'https:'),
    authToken: config.databaseAuthToken,
    intMode: 'number',
  });
} else {
  const fs = require('node:fs');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  local = new DatabaseSync(config.dbPath);
  local.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
}

function enqueue(fn) {
  const result = localQueue.then(fn);
  localQueue = result.catch(() => {});
  return result;
}

function operate(localFn, remoteFn) {
  const tx = context.getStore();
  if (remote) return remoteFn(tx || remote);
  return tx ? Promise.resolve().then(localFn) : enqueue(localFn);
}

const db = {
  prepare(sql) {
    const query = (args) => operate(
      () => local.prepare(sql).all(...args),
      async (client) => (await client.execute({ sql, args })).rows.map((row) => ({ ...row }))
    );
    return {
      all: (...args) => query(args),
      get: async (...args) => (await query(args))[0],
      run: (...args) => operate(
        () => local.prepare(sql).run(...args),
        async (client) => {
          const result = await client.execute({ sql, args });
          return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid) };
        }
      ),
    };
  },
  exec(sql) {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
      throw new Error('Use db.transaction() for transaction control');
    }
    return operate(() => local.exec(sql), (client) => client.executeMultiple(sql));
  },
  async transaction(fn) {
    if (context.getStore()) return fn();
    if (remote) {
      const tx = await remote.transaction('write');
      try {
        const result = await context.run(tx, fn);
        await tx.commit();
        return result;
      } catch (err) {
        try { await tx.rollback(); } catch { /* preserve original failure */ }
        throw err;
      } finally { tx.close(); }
    }
    // Serialize local work across awaits so no request sees a half-written user.
    return enqueue(async () => {
      local.exec('BEGIN IMMEDIATE');
      try {
        const result = await context.run(local, fn);
        local.exec('COMMIT');
        return result;
      } catch (err) { local.exec('ROLLBACK'); throw err; }
    });
  },
  async close() {
    if (remote) remote.close();
    else { await localQueue; local.close(); }
  },
};

module.exports = db;
