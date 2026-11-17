"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { mkdirSync } = require("node:fs");
const { join } = require("node:path");

function openDatabase() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (Boolean(url) !== Boolean(authToken)) {
    throw new Error("Set both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to connect to Turso.");
  }
  if (process.env.RENDER === "true" && !url && !process.env.CHAT_DATA_DIR?.trim()) {
    throw new Error("Configure Turso or set CHAT_DATA_DIR to a persistent disk on Render.");
  }

  let connection;
  if (url) {
    if (!/^(libsql|https):\/\//i.test(url)) {
      throw new Error("TURSO_DATABASE_URL must be a libsql:// or https:// database URL.");
    }
    const { createClient } = require("@libsql/client");
    connection = createClient({ url, authToken });
  } else {
    const { DatabaseSync } = require("node:sqlite");
    const dir = process.env.CHAT_DATA_DIR || join(__dirname, "data");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const sqlite = new DatabaseSync(join(dir, "chat.sqlite"), { timeout: 5000 });
    sqlite.exec("PRAGMA journal_mode = WAL");
    connection = {
      executeMultiple: sql => sqlite.exec(sql),
      execute: ({ sql, args }) => ({ rows: sqlite.prepare(sql).all(...args) }),
      transaction() {
        sqlite.exec("BEGIN IMMEDIATE");
        let closed = false;
        return {
          execute: this.execute,
          commit() {
            sqlite.exec("COMMIT");
            closed = true;
          },
          close() {
            if (!closed) sqlite.exec("ROLLBACK");
          },
        };
      },
    };
  }

  const scope = new AsyncLocalStorage();
  let writes = Promise.resolve();
  async function execute(sql, args) {
    const transaction = scope.getStore();
    if (transaction) return transaction.execute({ sql, args });
    if (!url) await writes;
    return connection.execute({ sql, args });
  }
  return {
    exec: sql => connection.executeMultiple(sql),
    get: async (sql, ...args) => (await execute(sql, args)).rows[0],
    all: async (sql, ...args) => (await execute(sql, args)).rows,
    run: (sql, ...args) => execute(sql, args),
    write(action) {
      const result = writes.then(async () => {
        const transaction = await connection.transaction("write");
        try {
          const value = await scope.run(transaction, action);
          await transaction.commit();
          return value;
        } finally {
          transaction.close();
        }
      });
      writes = result.catch(() => {});
      return result;
    },
  };
}

module.exports = openDatabase;
