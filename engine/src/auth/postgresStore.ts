import type { Database } from "../db/database.js";
import type { AuthStore, PendingCode, Role, SessionRecord, User } from "./types.js";

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  created_at: Date;
}

interface CodeRow {
  email: string;
  code_hash: string;
  expires_at: Date;
  requested_at: Date;
  attempts: number;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: Date;
}

export class PostgresAuthStore implements AuthStore {
  constructor(private readonly db: Database) {}

  async findUserByEmail(email: string): Promise<User | null> {
    const result = await this.db.query<UserRow>(
      "SELECT id, email, display_name, role, created_at FROM users WHERE email = $1",
      [email]
    );
    return result.rows[0] ? toUser(result.rows[0]) : null;
  }

  async getUser(userId: string): Promise<User | null> {
    const result = await this.db.query<UserRow>(
      "SELECT id, email, display_name, role, created_at FROM users WHERE id = $1",
      [userId]
    );
    return result.rows[0] ? toUser(result.rows[0]) : null;
  }

  async createUser(user: User): Promise<void> {
    await this.db.query(
      `INSERT INTO users (id, email, display_name, role, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [user.id, user.email, user.displayName, user.role, new Date(user.createdAt)]
    );
  }

  async savePendingCode(pending: PendingCode): Promise<void> {
    await this.db.query(
      `INSERT INTO login_codes (email, code_hash, expires_at, requested_at, attempts)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         expires_at = EXCLUDED.expires_at,
         requested_at = EXCLUDED.requested_at,
         attempts = 0`,
      [
        pending.email,
        pending.codeHash,
        new Date(pending.expiresAt),
        new Date(pending.requestedAt),
        pending.attempts,
      ]
    );
  }

  async getPendingCode(email: string): Promise<PendingCode | null> {
    const result = await this.db.query<CodeRow>(
      "SELECT email, code_hash, expires_at, requested_at, attempts FROM login_codes WHERE email = $1",
      [email]
    );
    const row = result.rows[0];
    return row
      ? {
          email: row.email,
          codeHash: row.code_hash,
          expiresAt: row.expires_at.getTime(),
          requestedAt: row.requested_at.getTime(),
          attempts: row.attempts,
        }
      : null;
  }

  async deletePendingCode(email: string): Promise<void> {
    await this.db.query("DELETE FROM login_codes WHERE email = $1", [email]);
  }

  async recordAttempt(email: string): Promise<number> {
    const result = await this.db.query<{ attempts: number }>(
      "UPDATE login_codes SET attempts = attempts + 1 WHERE email = $1 RETURNING attempts",
      [email]
    );
    return result.rows[0]?.attempts ?? 0;
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO NOTHING`,
      [session.tokenHash, session.userId, new Date(session.expiresAt)]
    );
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const result = await this.db.query<SessionRow>(
      "SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = $1",
      [tokenHash]
    );
    const row = result.rows[0];
    return row
      ? {
          tokenHash: row.token_hash,
          userId: row.user_id,
          expiresAt: row.expires_at.getTime(),
        }
      : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async deleteExpired(now: number): Promise<void> {
    const at = new Date(now);
    await this.db.query("DELETE FROM login_codes WHERE expires_at <= $1", [at]);
    await this.db.query("DELETE FROM sessions WHERE expires_at <= $1", [at]);
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at.getTime(),
  };
}