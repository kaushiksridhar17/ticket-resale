import type { AuthStore, PendingCode, SessionRecord, User } from "./types.js";

export class MemoryAuthStore implements AuthStore {
  private users = new Map<string, User>();
  private usersByEmail = new Map<string, string>();
  private codes = new Map<string, PendingCode>();
  private sessions = new Map<string, SessionRecord>();

  async findUserByEmail(email: string): Promise<User | null> {
    const id = this.usersByEmail.get(email);
    return id ? this.users.get(id) ?? null : null;
  }

  async getUser(userId: string): Promise<User | null> {
    return this.users.get(userId) ?? null;
  }

  async createUser(user: User): Promise<void> {
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
  }

  async savePendingCode(pending: PendingCode): Promise<void> {
    this.codes.set(pending.email, { ...pending });
  }

  async getPendingCode(email: string): Promise<PendingCode | null> {
    const pending = this.codes.get(email);
    return pending ? { ...pending } : null;
  }

  async deletePendingCode(email: string): Promise<void> {
    this.codes.delete(email);
  }

  async recordAttempt(email: string): Promise<number> {
    const pending = this.codes.get(email);
    if (!pending) {
      return 0;
    }
    pending.attempts += 1;
    return pending.attempts;
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

  async deleteExpired(now: number): Promise<void> {
    for (const [email, pending] of this.codes) {
      if (pending.expiresAt <= now) {
        this.codes.delete(email);
      }
    }
    for (const [tokenHash, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(tokenHash);
      }
    }
  }
}