import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { AuthStore, Role, SessionRecord, User } from "./types.js";

export type AuthErrorCode =
  | "invalid_email"
  | "cooldown"
  | "no_code"
  | "expired"
  | "invalid_code"
  | "too_many_attempts";

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthOptions {
  pepper: string;
  sendCode: (email: string, code: string) => Promise<void> | void;
  organizerEmails?: string[];
  staffEmails?: string[];
  now?: () => number;
  codeTtlMs?: number;
  sessionTtlMs?: number;
  resendCooldownMs?: number;
  maxAttempts?: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export class AuthService {
  private readonly organizers: Set<string>;
  private readonly staff: Set<string>;
  private readonly now: () => number;
  private readonly codeTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly resendCooldownMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly store: AuthStore,
    private readonly options: AuthOptions
  ) {
    this.organizers = new Set(
      (options.organizerEmails ?? []).map((email) => normalizeEmail(email))
    );
    this.staff = new Set(
      (options.staffEmails ?? []).map((email) => normalizeEmail(email))
    );
    this.now = options.now ?? (() => Date.now());
    this.codeTtlMs = options.codeTtlMs ?? 10 * 60 * 1000;
    this.sessionTtlMs = options.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000;
    this.resendCooldownMs = options.resendCooldownMs ?? 60 * 1000;
    this.maxAttempts = options.maxAttempts ?? 5;
  }

  async requestCode(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL.test(email) || email.length > 200) {
      throw new AuthError("invalid_email", "That does not look like an email address");
    }

    const now = this.now();
    const existing = await this.store.getPendingCode(email);
    if (existing && now - existing.requestedAt < this.resendCooldownMs) {
      throw new AuthError("cooldown", "A code was just sent. Try again in a moment.");
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await this.store.savePendingCode({
      email,
      codeHash: this.hash(`${email}:${code}`),
      expiresAt: now + this.codeTtlMs,
      requestedAt: now,
      attempts: 0,
    });

    await this.options.sendCode(email, code);
  }

  async verifyCode(
    rawEmail: string,
    code: string
  ): Promise<{ token: string; user: User }> {
    const email = normalizeEmail(rawEmail);
    const pending = await this.store.getPendingCode(email);
    const now = this.now();

    if (!pending) {
      throw new AuthError("no_code", "Request a code first");
    }
    if (pending.expiresAt <= now) {
      await this.store.deletePendingCode(email);
      throw new AuthError("expired", "That code has expired");
    }

    if (!this.matches(this.hash(`${email}:${code.trim()}`), pending.codeHash)) {
      const attempts = await this.store.recordAttempt(email);
      if (attempts >= this.maxAttempts) {
        await this.store.deletePendingCode(email);
        throw new AuthError("too_many_attempts", "Too many attempts. Request a new code.");
      }
      throw new AuthError("invalid_code", "That code is not right");
    }

    await this.store.deletePendingCode(email);

    const existingUser = await this.store.findUserByEmail(email);
    const user = existingUser
      ? await this.syncRole(existingUser)
      : await this.register(email, now);
    const token = randomBytes(32).toString("base64url");
    const session: SessionRecord = {
      tokenHash: this.hash(token),
      userId: user.id,
      expiresAt: now + this.sessionTtlMs,
    };
    await this.store.createSession(session);

    return { token, user };
  }

  async resolveToken(token: string | undefined): Promise<User | null> {
    if (!token) {
      return null;
    }
    const session = await this.store.getSession(this.hash(token));
    if (!session) {
      return null;
    }
    if (session.expiresAt <= this.now()) {
      await this.store.deleteSession(session.tokenHash);
      return null;
    }
    return this.store.getUser(session.userId);
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) {
      await this.store.deleteSession(this.hash(token));
    }
  }

  sessionMaxAgeSeconds(): number {
    return Math.floor(this.sessionTtlMs / 1000);
  }

  private async syncRole(user: User): Promise<User> {
    const expected = this.roleFor(user.email);
    if (user.role === expected) {
      return user;
    }
    await this.store.setRole(user.id, expected);
    return { ...user, role: expected };
  }

  private roleFor(email: string): Role {
    if (this.staff.has(email)) {
      return "staff";
    }
    return this.organizers.has(email) ? "organizer" : "attendee";
  }

  private async register(email: string, now: number): Promise<User> {
    const role: Role = this.roleFor(email);
    const user: User = {
      id: `usr_${randomBytes(9).toString("base64url")}`,
      email,
      displayName: null,
      role,
      createdAt: now,
    };
    await this.store.createUser(user);
    return user;
  }

  private hash(value: string): string {
    return createHash("sha256")
      .update(`${this.options.pepper}:${value}`)
      .digest("hex");
  }

  private matches(a: string, b: string): boolean {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
