import { createHash, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword, WeakPassword } from "./passwords.js";
import type {
  AuthStore,
  NewUser,
  Role,
  SessionRecord,
  User,
  UserStatus,
} from "./types.js";

export type AuthErrorCode =
  | "invalid_email"
  | "weak_password"
  | "email_taken"
  | "invalid_role"
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
  role: Role;
  displayName?: string | null;
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
    if (registration.role !== "seller" && registration.role !== "customer") {
      throw new AuthError("invalid_role", "Pick either a buying or a selling account");
    }
    if (await this.store.findUserByEmail(email)) {
      throw new AuthError("email_taken", "There is already an account on that address");
    }

    const user = await this.create({
      email,
      password: registration.password,
      role: registration.role,
      displayName: registration.displayName ?? null,
    });

    return { token: await this.startSession(user), user };
  }

  async logIn(
    rawEmail: string,
    password: string,
    expectedRole?: Role
  ): Promise<{ token: string; user: User }> {
    const email = normalizeEmail(rawEmail);
    const user = await this.store.findUserByEmail(email);

    const stored = user ? await this.store.getPasswordHash(user.id) : null;
    const correct = stored ? await verifyPassword(password, stored) : false;

    if (!user || !correct) {
      throw new AuthError("wrong_credentials", "That email and password do not match");
    }
    if (expectedRole && user.role !== expectedRole) {
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
    });
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

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    await this.store.setStatus(userId, status);
    if (status === "suspended") {
      await this.store.deleteSessionsFor(userId);
    }
  }

  sessionMaxAgeSeconds(): number {
    return Math.floor(this.sessionTtlMs / 1000);
  }

  private async create(registration: Required<Registration>): Promise<User> {
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(registration.password);
    } catch (error) {
      if (error instanceof WeakPassword) {
        throw new AuthError("weak_password", error.message);
      }
      throw error;
    }

    const user: NewUser = {
      id: `usr_${randomBytes(9).toString("base64url")}`,
      email: registration.email,
      displayName: registration.displayName,
      role: registration.role,
      status: "active",
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
