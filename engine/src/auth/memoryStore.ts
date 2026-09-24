import type {
  AuthStore,
  NewUser,
  Role,
  SessionRecord,
  Settings,
  User,
  UserStatus,
} from "./types.js";

export class MemoryAuthStore implements AuthStore {
  private users = new Map<string, NewUser>();
  private usersByEmail = new Map<string, string>();
  private sessions = new Map<string, SessionRecord>();

  async findUserByEmail(email: string): Promise<User | null> {
    const id = this.usersByEmail.get(email);
    return id ? this.plain(id) : null;
  }

  async getUser(userId: string): Promise<User | null> {
    return this.plain(userId);
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    return this.users.get(userId)?.passwordHash ?? null;
  }

  async createUser(user: NewUser): Promise<void> {
    if (this.usersByEmail.has(user.email)) {
      throw new Error(`Account ${user.email} already exists`);
    }
    this.users.set(user.id, { ...user });
    this.usersByEmail.set(user.email, user.id);
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.passwordHash = passwordHash;
    }
  }

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.status = status;
    }
  }

  async setSettings(userId: string, settings: Settings): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.buys = settings.buys;
      user.sells = settings.sells;
      user.theme = settings.theme;
    }
  }

  async countByRole(role: Role): Promise<number> {
    let count = 0;
    for (const user of this.users.values()) {
      if (user.role === role) {
        count += 1;
      }
    }
    return count;
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.tokenHash, { ...session });
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(tokenHash);
    return session ? { ...session } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async deleteSessionsFor(userId: string): Promise<void> {
    for (const [tokenHash, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(tokenHash);
      }
    }
  }

  async deleteExpired(now: number): Promise<void> {
    for (const [tokenHash, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(tokenHash);
      }
    }
  }

  private plain(userId: string): User | null {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }
    const { passwordHash: _ignored, ...plain } = user;
    return plain;
  }
}
