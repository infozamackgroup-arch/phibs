// Prints the STRUCTURE of the old dashboard database (table names, columns, row counts).
// It does not print any guest or payment data.
// Usage:  OLD_DATABASE_URL="postgresql://..." node scripts/inspect-old-db.js
const { Pool } = require('pg');
const url = process.env.OLD_DATABASE_URL;
if (!url) { console.error('Set OLD_DATABASE_URL first (see README).'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
(async () => {
  const t = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1");
  for (const { table_name } of t.rows) {
    const c = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [table_name]);
    const n = await pool.query('SELECT COUNT(*) AS n FROM "' + table_name.replace(/"/g, '') + '"');
    console.log('\nTABLE ' + table_name + '  (' + n.rows[0].n + ' rows)');
    c.rows.forEach(r => console.log('   ' + r.column_name + '  ' + r.data_type));
  }
  await pool.end();
})().catch(e => { console.error('Could not read the database:', e.message); process.exit(1); });
