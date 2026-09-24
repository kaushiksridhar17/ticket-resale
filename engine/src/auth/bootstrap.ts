import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AuthService } from "./service.js";

export interface AdminDetails {
  email: string;
  password: string;
  name?: string | null;
}

export function readAdminFile(path: string): AdminDetails | null {
  let raw: string;
  try {
    raw = readFileSync(resolve(path), "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }

  const details = parsed as Partial<AdminDetails>;
  if (typeof details.email !== "string" || typeof details.password !== "string") {
    throw new Error(`${path} needs both an email and a password`);
  }

  return {
    email: details.email,
    password: details.password,
    name: typeof details.name === "string" ? details.name : null,
  };
}

export function readAdminEnv(
  env: NodeJS.ProcessEnv = process.env
): AdminDetails | null {
  const email = env.ADMIN_EMAIL?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!email || !password) {
    return null;
  }
  return { email, password, name: env.ADMIN_NAME?.trim() || null };
}

export function findAdmin(
  path: string,
  env: NodeJS.ProcessEnv = process.env
): AdminDetails | null {
  return readAdminFile(path) ?? readAdminEnv(env);
}

export async function bootstrapAdmin(
  auth: AuthService,
  details: AdminDetails | null
): Promise<string | null> {
  if (!details) {
    return null;
  }
  const admin = await auth.ensureAdmin(
    details.email,
    details.password,
    details.name ?? null
  );
  return admin ? admin.email : null;
}
