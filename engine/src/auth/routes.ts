import type { FastifyInstance } from "fastify";
import { AuthError, type AuthService } from "./service.js";
import { clearSessionCookie, publicUser, setSessionCookie } from "./plugin.js";
import type { Role } from "./types.js";

const registerSchema = {
  body: {
    type: "object",
    required: ["email", "password", "role"],
    properties: {
      email: { type: "string", minLength: 3, maxLength: 200 },
      password: { type: "string", minLength: 1, maxLength: 200 },
      role: { type: "string", enum: ["seller", "customer"] },
      displayName: { type: "string", maxLength: 80 },
    },
  },
} as const;

const loginSchema = {
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", minLength: 3, maxLength: 200 },
      password: { type: "string", minLength: 1, maxLength: 200 },
      role: { type: "string", enum: ["admin", "seller", "customer"] },
    },
  },
} as const;

const STATUS: Record<string, number> = {
  invalid_email: 400,
  weak_password: 400,
  invalid_role: 400,
  email_taken: 409,
  wrong_credentials: 401,
  suspended: 403,
};

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  app.post("/auth/register", { schema: registerSchema }, async (request, reply) => {
    const body = request.body as {
      email: string;
      password: string;
      role: Role;
      displayName?: string;
    };

    try {
      const { token, user } = await auth.register({
        email: body.email,
        password: body.password,
        role: body.role,
        displayName: body.displayName?.trim() || null,
      });
      setSessionCookie(reply, token, auth.sessionMaxAgeSeconds());
      return reply.code(201).send({ user: publicUser(user) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/auth/login", { schema: loginSchema }, async (request, reply) => {
    const body = request.body as {
      email: string;
      password: string;
      role?: Role;
    };

    try {
      const { token, user } = await auth.logIn(body.email, body.password, body.role);
      setSessionCookie(reply, token, auth.sessionMaxAgeSeconds());
      return reply.send({ user: publicUser(user) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    await auth.logOut(request.sessionToken);
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

function fail(reply: Parameters<typeof clearSessionCookie>[0], error: unknown) {
  if (error instanceof AuthError) {
    return reply
      .code(STATUS[error.code] ?? 400)
      .send({ error: error.message, code: error.code });
  }
  throw error;
}
