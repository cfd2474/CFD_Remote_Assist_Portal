import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgresql://cfd:cfd_secret@localhost:5432/cfd_remote_assist' });
async function run() {
  const res = await pool.query("SELECT token, is_active, expires_at FROM enrollment_tokens");
  console.log("Tokens:", res.rows);
  const devs = await pool.query("SELECT uid, device_name FROM devices");
  console.log("Devices:", devs.rows);
  process.exit(0);
}
run().catch(console.error);
