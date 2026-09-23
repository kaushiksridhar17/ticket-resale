export type Role = "attendee" | "organizer" | "staff";

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  createdAt: number;
}

export interface PendingCode {
  email: string;
  codeHash: string;
  expiresAt: number;
  requestedAt: number;
  attempts: number;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  expiresAt: number;
}

export interface AuthStore {
  findUserByEmail(email: string): Promise<User | null>;
  getUser(userId: string): Promise<User | null>;
  createUser(user: User): Promise<void>;
  setRole(userId: string, role: Role): Promise<void>;
  savePendingCode(pending: PendingCode): Promise<void>;
  getPendingCode(email: string): Promise<PendingCode | null>;
  deletePendingCode(email: string): Promise<void>;
  recordAttempt(email: string): Promise<number>;
  createSession(session: SessionRecord): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpired(now: number): Promise<void>;
}
