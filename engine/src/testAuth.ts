import type { FastifyInstance } from "fastify";

export const TEST_PASSWORD = "test-password";

export interface SignUpOptions {
  buys?: boolean;
  sells?: boolean;
  password?: string;
  displayName?: string;
}

export async function signUp(
  app: FastifyInstance,
  email: string,
  options: SignUpOptions = {}
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email,
      password: options.password ?? TEST_PASSWORD,
      buys: options.buys ?? true,
      sells: options.sells ?? false,
      ...(options.displayName ? { displayName: options.displayName } : {}),
    },
  });
  return sessionFrom(response, email);
}

export async function signIn(
  app: FastifyInstance,
  email: string,
  password = TEST_PASSWORD
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  return sessionFrom(response, email);
}

export async function userIdFor(
  app: FastifyInstance,
  session: string
): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: "/me",
    cookies: { session },
  });
  return response.json().user.id;
}

function sessionFrom(
  response: { cookies: { name: string; value: string }[]; statusCode: number; body: string },
  email: string
): string {
  const cookie = response.cookies.find((entry) => entry.name === "session");
  if (!cookie) {
    throw new Error(
      `No session for ${email}: ${response.statusCode} ${response.body}`
    );
  }
  return cookie.value;
}
