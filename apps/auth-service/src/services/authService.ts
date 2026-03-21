import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getPool } from '@bx/database';
import { generateApiKey, generateId, hashApiKey } from '@bx/shared-utils';
import { JwtPayload, AuthScope } from '@bx/shared-types';

const JWT_SECRET = process.env.JWT_SECRET ?? 'changeme-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '1h';
const REFRESH_EXPIRES_IN = process.env.REFRESH_EXPIRES_IN ?? '7d';

export class AuthService {
  private db = getPool();

  async login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { rows } = await this.db.query(
      'SELECT id, partner_id, password_hash, scopes FROM auth_users WHERE email = $1',
      [email]
    );
    if (!rows.length) throw new Error('Invalid credentials');

    const user = rows[0] as { id: string; partner_id: string; password_hash: string; scopes: string[] };
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new Error('Invalid credentials');

    return this.issueTokenPair(user.partner_id, user.scopes);
  }

  async clientCredentials(clientId: string, clientSecret: string): Promise<{ access_token: string; token_type: string; expires_in: number }> {
    const { rows } = await this.db.query(
      'SELECT partner_id, scopes FROM oauth_clients WHERE client_id = $1 AND client_secret_hash = $2',
      [clientId, hashApiKey(clientSecret)]
    );
    if (!rows.length) throw new Error('Invalid client');

    const client = rows[0] as { partner_id: string; scopes: string[] };
    const accessToken = this.signJwt(client.partner_id, client.scopes);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: 3600 };
  }

  async refreshToken(token: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { rows } = await this.db.query(
      'SELECT partner_id, scopes FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) throw new Error('Invalid refresh token');

    const row = rows[0] as { partner_id: string; scopes: string[] };
    // Rotate: delete old, issue new
    await this.db.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
    return this.issueTokenPair(row.partner_id, row.scopes);
  }

  async issueApiKey(partnerId: string): Promise<{ apiKey: string }> {
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const keyId = generateId();
    await this.db.query(
      'INSERT INTO api_keys (id, partner_id, key_hash, created_at) VALUES ($1, $2, $3, NOW())',
      [keyId, partnerId, keyHash]
    );
    return { apiKey }; // Return plain key once — never stored
  }

  async revokeApiKey(partnerId: string, keyId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM api_keys WHERE id = $1 AND partner_id = $2',
      [keyId, partnerId]
    );
  }

  async changePassword(partnerId: string, currentPassword: string, newPassword: string): Promise<void> {
    const { rows } = await this.db.query(
      'SELECT id, password_hash FROM auth_users WHERE partner_id = $1',
      [partnerId]
    );
    if (!rows.length) throw new Error('User not found');

    const user = rows[0] as { id: string; password_hash: string };
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw new Error('Current password is incorrect');

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.db.query('UPDATE auth_users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
  }

  private signJwt(partnerId: string, scopes: string[]): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = { sub: partnerId, partnerId, scopes: scopes as AuthScope[] };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
  }

  private async issueTokenPair(partnerId: string, scopes: string[]): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.signJwt(partnerId, scopes);
    const refreshToken = generateId() + generateId(); // 72-char random token
    await this.db.query(
      'INSERT INTO refresh_tokens (token, partner_id, scopes, expires_at) VALUES ($1, $2, $3, NOW() + $4::interval)',
      [refreshToken, partnerId, scopes, REFRESH_EXPIRES_IN]
    );
    return { accessToken, refreshToken };
  }
}
