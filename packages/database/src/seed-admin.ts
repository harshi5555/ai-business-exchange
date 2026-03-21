import bcrypt from 'bcryptjs';
import { getPool } from './index';

const PLATFORM_PARTNER_ID = '00000000-0000-0000-0000-000000000001';

const ADMIN_EMAIL = 'admin';
const ADMIN_PASSWORD = 'changeme';

/**
 * Seeds the platform admin user on first startup.
 * Default credentials: admin / changeme — users should change the password via the portal.
 * Idempotent — safe to call on every restart.
 */
export async function seedAdmin(): Promise<void> {
  const email = ADMIN_EMAIL;
  const password = ADMIN_PASSWORD;

  const db = getPool();

  const { rows } = await db.query('SELECT id FROM auth_users WHERE email = $1', [email]);
  if (rows.length > 0) return; // already seeded

  const passwordHash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO auth_users (id, partner_id, email, password_hash, scopes)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4)`,
    [PLATFORM_PARTNER_ID, email, passwordHash, ['admin']]
  );

  console.log(`[seed-admin] Admin user created: ${email}`);
}
