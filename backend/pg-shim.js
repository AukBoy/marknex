// PostgreSQL compatibility shim.
//
// Exposes the same callback API as node-sqlite3 (db.run / db.get / db.all /
// db.prepare / db.serialize) so the rest of the app keeps working unchanged,
// while persisting to a real Postgres database (so data survives redeploys).
//
// It translates SQLite SQL to Postgres on the fly:
//   ? → $1,$2,…          INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
//   DATETIME → TIMESTAMP  INSERT OR IGNORE → INSERT … ON CONFLICT DO NOTHING
//   PRAGMA … → no-op      CREATE VIEW IF NOT EXISTS → CREATE OR REPLACE VIEW
//   ALTER TABLE … ADD COLUMN → … ADD COLUMN IF NOT EXISTS
//   json_array_length(x) → json_array_length((x)::json)
// and appends RETURNING id to INSERTs so `this.lastID` works.
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
});

pool.on('error', (err) => console.error('[PG pool error]', err.message));

// Run statements in submission order (mirrors SQLite's serialized mode, which
// the schema setup relies on). App load is light, so a single chain is fine.
let chain = Promise.resolve();
function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.then(() => {}, () => {});
    return run;
}

function translate(sql) {
    let s = sql.trim();
    if (/^PRAGMA/i.test(s)) return null;                       // no-op in PG
    s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    s = s.replace(/\bAUTOINCREMENT\b/gi, '');
    s = s.replace(/\bDATETIME\b/gi, 'TIMESTAMP');
    s = s.replace(/CREATE\s+VIEW\s+IF\s+NOT\s+EXISTS/gi, 'CREATE OR REPLACE VIEW');
    s = s.replace(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+/gi, 'ALTER TABLE $1 ADD COLUMN IF NOT EXISTS ');
    s = s.replace(/json_array_length\(([^)]+)\)/gi, 'json_array_length(($1)::json)');
    return s;
}

function toPgParams(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

async function exec(sql, params) {
    let s = translate(sql);
    if (s === null) return { rows: [], rowCount: 0 };

    const isInsert = /^\s*INSERT/i.test(s);
    const orIgnore = /INSERT\s+OR\s+IGNORE/i.test(s);
    if (orIgnore) s = s.replace(/INSERT\s+OR\s+IGNORE/i, 'INSERT');

    s = toPgParams(s);

    if (orIgnore && !/ON\s+CONFLICT/i.test(s)) s += ' ON CONFLICT DO NOTHING';
    // Append RETURNING id so callbacks can read this.lastID. Skip OR IGNORE
    // inserts (the `settings` table has no id column and never needs lastID).
    if (isInsert && !orIgnore && !/RETURNING/i.test(s)) s += ' RETURNING id';

    try {
        return await pool.query(s, params);
    } catch (err) {
        // ADD COLUMN/duplicate-object errors are expected on re-runs — swallow.
        if (/already exists|duplicate column/i.test(err.message)) return { rows: [], rowCount: 0 };
        console.error('[PG error]', err.message, '\n  SQL:', s);
        throw err;
    }
}

const db = {
    run(sql, params, cb) {
        if (typeof params === 'function') { cb = params; params = []; }
        params = params || [];
        enqueue(() => exec(sql, params)
            .then(res => { if (cb) cb.call({ lastID: res.rows && res.rows[0] ? res.rows[0].id : undefined, changes: res.rowCount }, null); })
            .catch(err => { if (cb) cb.call({}, err); }));
    },
    get(sql, params, cb) {
        if (typeof params === 'function') { cb = params; params = []; }
        params = params || [];
        enqueue(() => exec(sql, params)
            .then(res => cb && cb(null, res.rows[0]))
            .catch(err => cb && cb(err)));
    },
    all(sql, params, cb) {
        if (typeof params === 'function') { cb = params; params = []; }
        params = params || [];
        enqueue(() => exec(sql, params)
            .then(res => cb && cb(null, res.rows))
            .catch(err => cb && cb(err)));
    },
    prepare(sql) {
        return {
            run(...args) {
                let cb = null;
                if (typeof args[args.length - 1] === 'function') cb = args.pop();
                db.run(sql, args, cb);
                return this;
            },
            finalize(cb) { if (cb) enqueue(() => Promise.resolve().then(() => cb(null))); },
        };
    },
    serialize(fn) { fn(); },   // statements self-sequence through the chain
};

module.exports = db;
