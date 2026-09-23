import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "./service.js";
import type { Role, User } from "./types.js";

export const SESSION_COOKIE = "session";

function secureCookies(): boolean {
  const explicit = process.env.SECURE_COOKIES;
  if (explicit !== undefined) {
    return explicit !== "false";
  }
  return process.env.NODE_ENV === "production";
}

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
    sessionToken?: string;
  }
}

export async function registerAuthPlugin(
  app: FastifyInstance,
  auth: AuthService
): Promise<void> {
  await app.register(cookie);

  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.sessionToken = token;
    request.user = await auth.resolveToken(token);
  });
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  maxAgeSeconds: number
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export class NotAuthenticated extends Error {}
export class NotAllowed extends Error {}

export function requireUser(request: FastifyRequest): User {
  if (!request.user) {
    throw new NotAuthenticated("Sign in first");
  }
  return request.user;
}

export function requireRole(request: FastifyRequest, ...roles: Role[]): User {
  const user = requireUser(request);
  if (!roles.includes(user.role)) {
    throw new NotAllowed("You do not have access to this");
  }
  return user;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}
