import type { FastifyInstance } from "fastify";
import { AuthError, type AuthService } from "./service.js";
import {
  clearSessionCookie,
  publicUser,
  requireUser,
  setSessionCookie,
} from "./plugin.js";
import type { Theme } from "./types.js";

const registerSchema = {
  body: {
    type: "object",
    required: ["email", "password", "buys", "sells"],
    properties: {
      email: { type: "string", minLength: 3, maxLength: 200 },
      password: { type: "string", minLength: 1, maxLength: 200 },
      buys: { type: "boolean" },
      sells: { type: "boolean" },
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
    },
  },
} as const;

const settingsSchema = {
  body: {
    type: "object",
    minProperties: 1,
    properties: {
      buys: { type: "boolean" },
      sells: { type: "boolean" },
      theme: { type: "string", enum: ["light", "dark", "system"] },
    },
  },
} as const;

const passwordSchema = {
  body: {
    type: "object",
    required: ["currentPassword", "newPassword"],
    properties: {
      currentPassword: { type: "string", minLength: 1, maxLength: 200 },
      newPassword: { type: "string", minLength: 1, maxLength: 200 },
    },
  },
} as const;

const STATUS: Record<string, number> = {
  invalid_email: 400,
  weak_password: 400,
  nothing_chosen: 400,
  invalid_theme: 400,
  email_taken: 409,
  wrong_credentials: 401,
  suspended: 403,
};

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  app.post("/auth/register", { schema: registerSchema }, async (request, reply) => {
    const body = request.body as {
      email: string;
      password: string;
      buys: boolean;
      sells: boolean;
      displayName?: string;
    };

    try {
      const { token, user } = await auth.register({
        email: body.email,
        password: body.password,
        buys: body.buys,
        sells: body.sells,
        displayName: body.displayName?.trim() || null,
      });
      setSessionCookie(reply, token, auth.sessionMaxAgeSeconds());
      return reply.code(201).send({ user: publicUser(user) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/auth/login", { schema: loginSchema }, async (request, reply) => {
    const body = request.body as { email: string; password: string };

    try {
      const { token, user } = await auth.logIn(body.email, body.password);
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

  app.patch("/me/settings", { schema: settingsSchema }, async (request, reply) => {
    const user = requireUser(request);
    const body = request.body as {
      buys?: boolean;
      sells?: boolean;
      theme?: Theme;
    };

    try {
      const updated = await auth.updateSettings(user.id, body);
      return { user: publicUser(updated) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/me/password", { schema: passwordSchema }, async (request, reply) => {
    const user = requireUser(request);
    const body = request.body as {
      currentPassword: string;
      newPassword: string;
    };

    try {
      const token = await auth.changePassword(
        user.id,
        body.currentPassword,
        body.newPassword
      );
      setSessionCookie(reply, token, auth.sessionMaxAgeSeconds());
      return reply.code(204).send();
    } catch (error) {
      return fail(reply, error);
    }
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
