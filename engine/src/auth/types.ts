export type Role = "admin" | "seller" | "customer";

export const ROLES: Role[] = ["admin", "seller", "customer"];

export type UserStatus = "active" | "suspended";

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  status: UserStatus;
  createdAt: number;
}

export interface NewUser extends User {
  passwordHash: string;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  expiresAt: number;
}

export interface AuthStore {
  findUserByEmail(email: string): Promise<User | null>;
  getUser(userId: string): Promise<User | null>;
  getPasswordHash(userId: string): Promise<string | null>;
  createUser(user: NewUser): Promise<void>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
  setStatus(userId: string, status: UserStatus): Promise<void>;
  countByRole(role: Role): Promise<number>;
  createSession(session: SessionRecord): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsFor(userId: string): Promise<void>;
  deleteExpired(now: number): Promise<void>;
}
