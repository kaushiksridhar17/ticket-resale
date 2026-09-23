import type { FastifyInstance } from "fastify";
import { AuthError, type AuthService } from "./service.js";
import {
  clearSessionCookie,
  publicUser,
  setSessionCookie,
} from "./plugin.js";

const requestSchema = {
  body: {
    type: "object",
    required: ["email"],
    properties: {
      email: { type: "string", minLength: 3, maxLength: 200 },
    },
  },
} as const;

const verifySchema = {
  body: {
    type: "object",
    required: ["email", "code"],
    properties: {
      email: { type: "string", minLength: 3, maxLength: 200 },
      code: { type: "string", minLength: 6, maxLength: 6 },
    },
  },
} as const;

const STATUS: Record<string, number> = {
  invalid_email: 400,
  cooldown: 429,
  too_many_attempts: 429,
  no_code: 400,
  expired: 400,
  invalid_code: 400,
};

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService
): void {
  app.post("/auth/request", { schema: requestSchema }, async (request, reply) => {
    const { email } = request.body as { email: string };

    try {
      await auth.requestCode(email);
      return reply.code(202).send({ sent: true });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply
          .code(STATUS[error.code] ?? 400)
          .send({ error: error.message, code: error.code });
      }
      throw error;
    }
  });

  app.post("/auth/verify", { schema: verifySchema }, async (request, reply) => {
    const { email, code } = request.body as { email: string; code: string };

    try {
      const { token, user } = await auth.verifyCode(email, code);
      setSessionCookie(reply, token, auth.sessionMaxAgeSeconds());
      return reply.send({ user: publicUser(user) });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply
          .code(STATUS[error.code] ?? 400)
          .send({ error: error.message, code: error.code });
      }
      throw error;
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    await auth.logout(request.sessionToken);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get("/me", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Not signed in" });
    }
    return { user: publicUser(request.user) };
  });
}