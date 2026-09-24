import type { Database } from "../db/database.js";
import type {
  AuthStore,
  NewUser,
  Role,
  SessionRecord,
  Settings,
  Theme,
  User,
  UserStatus,
} from "./types.js";

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  status: UserStatus;
  buys: boolean;
  sells: boolean;
  theme: Theme;
  created_at: Date;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: Date;
}

const COLUMNS =
  "id, email, display_name, role, status, buys, sells, theme, created_at";

export class PostgresAuthStore implements AuthStore {
  constructor(private readonly db: Database) {}

  async findUserByEmail(email: string): Promise<User | null> {
    const result = await this.db.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE email = $1`,
      [email]
    );
    return result.rows[0] ? toUser(result.rows[0]) : null;
  }

  async getUser(userId: string): Promise<User | null> {
    const result = await this.db.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0] ? toUser(result.rows[0]) : null;
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    const result = await this.db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [userId]
    );
    return result.rows[0]?.password_hash ?? null;
  }

  async createUser(user: NewUser): Promise<void> {
    await this.db.query(
      `INSERT INTO users
         (id, email, display_name, role, status, buys, sells, theme, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        user.id,
        user.email,
        user.displayName,
        user.role,
        user.status,
        user.buys,
        user.sells,
        user.theme,
        user.passwordHash,
        new Date(user.createdAt),
      ]
    );
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [
      userId,
      passwordHash,
    ]);
  }

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    await this.db.query("UPDATE users SET status = $2 WHERE id = $1", [
      userId,
      status,
    ]);
  }

  async setSettings(userId: string, settings: Settings): Promise<void> {
    await this.db.query(
      "UPDATE users SET buys = $2, sells = $3, theme = $4 WHERE id = $1",
      [userId, settings.buys, settings.sells, settings.theme]
    );
  }

  async countByRole(role: Role): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      "SELECT count(*) FROM users WHERE role = $1",
      [role]
    );
    return Number(result.rows[0]?.count ?? 0);
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

  async deleteSessionsFor(userId: string): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  }

  async deleteExpired(now: number): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE expires_at <= $1", [
      new Date(now),
    ]);
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    buys: row.buys,
    sells: row.sells,
    theme: row.theme,
    createdAt: row.created_at.getTime(),
  };
}
