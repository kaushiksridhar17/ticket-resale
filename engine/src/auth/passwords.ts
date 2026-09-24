import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

export const DEFAULT_COST = 16_384;

function cost(): number {
  const configured = Number(process.env.PASSWORD_COST);
  return Number.isSafeInteger(configured) && configured >= 2
    ? configured
    : DEFAULT_COST;
}

export const MINIMUM_LENGTH = 8;
export const MAXIMUM_LENGTH = 200;

export class WeakPassword extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPassword";
  }
}

function derive(password: string, salt: Buffer, work: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N: work, r: BLOCK_SIZE, p: PARALLELISM },
      (error, key) => (error ? reject(error) : resolve(key))
    );
  });
}

export function checkStrength(password: string): void {
  if (password.length < MINIMUM_LENGTH) {
    throw new WeakPassword(
      `Passwords need at least ${MINIMUM_LENGTH} characters`
    );
  }
  if (password.length > MAXIMUM_LENGTH) {
    throw new WeakPassword("That password is unreasonably long");
  }
}

export async function hashPassword(password: string): Promise<string> {
  checkStrength(password);
  const work = cost();
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, work);
  return `scrypt$${work}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString(
    "base64url"
  )}$${key.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, costText, blockText, parallelText, saltText, keyText] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const cost = Number(costText);
  const blockSize = Number(blockText);
  const parallelism = Number(parallelText);
  if (
    !Number.isSafeInteger(cost) ||
    !Number.isSafeInteger(blockSize) ||
    !Number.isSafeInteger(parallelism)
  ) {
    return false;
  }

  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(keyText, "base64url");

  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      expected.length,
      { N: cost, r: blockSize, p: parallelism },
      (error, derived) => (error ? reject(error) : resolve(derived))
    );
  });

  return key.length === expected.length && timingSafeEqual(key, expected);
}
