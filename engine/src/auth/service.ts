import { createHash, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword, WeakPassword } from "./passwords.js";
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
import { THEMES } from "./types.js";

export type AuthErrorCode =
  | "invalid_email"
  | "weak_password"
  | "email_taken"
  | "nothing_chosen"
  | "invalid_theme"
  | "wrong_credentials"
  | "suspended";

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthOptions {
  pepper: string;
  now?: () => number;
  sessionTtlMs?: number;
}

export interface Registration {
  email: string;
  password: string;
  buys: boolean;
  sells: boolean;
  displayName?: string | null;
}

interface NewAccount {
  email: string;
  password: string;
  role: Role;
  displayName: string | null;
  buys: boolean;
  sells: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export class AuthService {
  private readonly now: () => number;
  private readonly sessionTtlMs: number;

  constructor(
    private readonly store: AuthStore,
    private readonly options: AuthOptions
  ) {
    this.now = options.now ?? (() => Date.now());
    this.sessionTtlMs = options.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  }

  async register(registration: Registration): Promise<{ token: string; user: User }> {
    const email = normalizeEmail(registration.email);
    if (!EMAIL.test(email) || email.length > 200) {
      throw new AuthError("invalid_email", "That does not look like an email address");
    }
    if (!registration.buys && !registration.sells) {
      throw new AuthError("nothing_chosen", "Pick at least one of buying or selling");
    }
    if (await this.store.findUserByEmail(email)) {
      throw new AuthError("email_taken", "There is already an account on that address");
    }

    const user = await this.create({
      email,
      password: registration.password,
      role: "member",
      displayName: registration.displayName ?? null,
      buys: registration.buys,
      sells: registration.sells,
    });

    return { token: await this.startSession(user), user };
  }

  async logIn(
    rawEmail: string,
    password: string
  ): Promise<{ token: string; user: User }> {
    const email = normalizeEmail(rawEmail);
    const user = await this.store.findUserByEmail(email);

    const stored = user ? await this.store.getPasswordHash(user.id) : null;
    const correct = stored ? await verifyPassword(password, stored) : false;

    if (!user || !correct) {
      throw new AuthError("wrong_credentials", "That email and password do not match");
    }
    if (user.status === "suspended") {
      throw new AuthError("suspended", "That account has been suspended");
    }

    return { token: await this.startSession(user), user };
  }

  async ensureAdmin(
    email: string,
    password: string,
    displayName: string | null
  ): Promise<User | null> {
    if ((await this.store.countByRole("admin")) > 0) {
      return null;
    }
    return this.create({
      email: normalizeEmail(email),
      password,
      role: "admin",
      displayName,
      buys: true,
      sells: true,
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.store.findUserByEmail(normalizeEmail(email));
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
    const user = await this.store.getUser(session.userId);
    return user && user.status === "active" ? user : null;
  }

  async logOut(token: string | undefined): Promise<void> {
    if (token) {
      await this.store.deleteSession(this.hash(token));
    }
  }

  async updateSettings(
    userId: string,
    changes: Partial<Settings>
  ): Promise<User> {
    const user = await this.store.getUser(userId);
    if (!user) {
      throw new AuthError("wrong_credentials", "That account no longer exists");
    }

    const settings: Settings = {
      buys: changes.buys ?? user.buys,
      sells: changes.sells ?? user.sells,
      theme: changes.theme ?? user.theme,
    };

    if (user.role !== "admin" && !settings.buys && !settings.sells) {
      throw new AuthError("nothing_chosen", "Pick at least one of buying or selling");
    }
    if (!THEMES.includes(settings.theme)) {
      throw new AuthError("invalid_theme", "That is not a theme");
    }

    await this.store.setSettings(userId, settings);
    return { ...user, ...settings };
  }

  async changePassword(
    userId: string,
    current: string,
    next: string
  ): Promise<string> {
    const stored = await this.store.getPasswordHash(userId);
    if (!stored || !(await verifyPassword(current, stored))) {
      throw new AuthError("wrong_credentials", "That is not your current password");
    }

    let passwordHash: string;
    try {
      passwordHash = await hashPassword(next);
    } catch (error) {
      if (error instanceof WeakPassword) {
        throw new AuthError("weak_password", error.message);
      }
      throw error;
    }

    await this.store.setPassword(userId, passwordHash);
    await this.store.deleteSessionsFor(userId);

    const user = await this.store.getUser(userId);
    if (!user) {
      throw new AuthError("wrong_credentials", "That account no longer exists");
    }
    return this.startSession(user);
  }

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    await this.store.setStatus(userId, status);
    if (status === "suspended") {
      await this.store.deleteSessionsFor(userId);
    }
  }

  sessionMaxAgeSeconds(): number {
    return Math.floor(this.sessionTtlMs / 1000);
  }

  private async create(account: NewAccount): Promise<User> {
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(account.password);
    } catch (error) {
      if (error instanceof WeakPassword) {
        throw new AuthError("weak_password", error.message);
      }
      throw error;
    }

    const user: NewUser = {
      id: `usr_${randomBytes(9).toString("base64url")}`,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      status: "active",
      buys: account.buys,
      sells: account.sells,
      theme: "system",
      createdAt: this.now(),
      passwordHash,
    };

    await this.store.createUser(user);
    const { passwordHash: _ignored, ...plain } = user;
    return plain;
  }

  private async startSession(user: User): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const session: SessionRecord = {
      tokenHash: this.hash(token),
      userId: user.id,
      expiresAt: this.now() + this.sessionTtlMs,
    };
    await this.store.createSession(session);
    return token;
  }

  private hash(value: string): string {
    return createHash("sha256")
      .update(`${this.options.pepper}:${value}`)
      .digest("hex");
  }
}
