const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const LOCAL_SESSION_COOKIE = "wacrm_local_session";
export const LOCAL_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const LOCAL_PASSWORD_ITERATIONS = 210_000;

const DEFAULT_LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_LOCAL_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

export interface LocalIdentity {
  userId: string;
  username: string;
  email: string;
  displayName: string;
  accountId: string;
  accountName: string;
  defaultCurrency: string;
}

interface LocalSessionPayload {
  v: 1;
  sub: string;
  iat: number;
  exp: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return difference === 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations: LOCAL_PASSWORD_ITERATIONS,
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

async function hmacKey(): Promise<CryptoKey> {
  const encodedSecret = process.env.LOCAL_AUTH_SESSION_SECRET;
  if (!encodedSecret) throw new Error("LOCAL_AUTH_SESSION_SECRET is not configured");
  const secret = base64UrlToBytes(encodedSecret);
  if (secret.length < 32) {
    throw new Error("LOCAL_AUTH_SESSION_SECRET must contain at least 32 random bytes");
  }
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function isLocalAuthEnabled(): boolean {
  return (
    process.env.LOCAL_AUTH_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_LOCAL_AUTH_ENABLED === "true"
  );
}

export function getLocalIdentity(): LocalIdentity {
  const username = process.env.LOCAL_AUTH_USERNAME?.trim() || "admin";
  return {
    userId: process.env.LOCAL_AUTH_USER_ID?.trim() || DEFAULT_LOCAL_USER_ID,
    username,
    email: process.env.LOCAL_AUTH_EMAIL?.trim() || `${username}@local`,
    displayName: process.env.LOCAL_AUTH_DISPLAY_NAME?.trim() || "Administrador local",
    accountId:
      process.env.LOCAL_AUTH_ACCOUNT_ID?.trim() || DEFAULT_LOCAL_ACCOUNT_ID,
    accountName: process.env.LOCAL_AUTH_ACCOUNT_NAME?.trim() || "CRM Local",
    defaultCurrency: process.env.LOCAL_AUTH_DEFAULT_CURRENCY?.trim() || "BRL",
  };
}

export async function verifyLocalCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  if (!isLocalAuthEnabled() || !username || !password) return false;

  const expectedSalt = process.env.LOCAL_AUTH_PASSWORD_SALT;
  const expectedHash = process.env.LOCAL_AUTH_PASSWORD_HASH;
  if (!expectedSalt || !expectedHash) return false;

  try {
    const [presentedUsername, configuredUsername] = await Promise.all([
      sha256(username.trim()),
      sha256(getLocalIdentity().username),
    ]);
    const passwordHash = await derivePasswordHash(
      password,
      base64UrlToBytes(expectedSalt),
    );

    return (
      constantTimeEqual(presentedUsername, configuredUsername) &&
      constantTimeEqual(passwordHash, base64UrlToBytes(expectedHash))
    );
  } catch {
    return false;
  }
}

export async function createLocalSessionToken(now = Date.now()): Promise<string> {
  if (!isLocalAuthEnabled()) throw new Error("Local authentication is disabled");

  const issuedAt = Math.floor(now / 1000);
  const payload: LocalSessionPayload = {
    v: 1,
    sub: getLocalIdentity().userId,
    iat: issuedAt,
    exp: issuedAt + LOCAL_SESSION_TTL_SECONDS,
  };
  const payloadSegment = bytesToBase64Url(
    encoder.encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    encoder.encode(payloadSegment),
  );
  return `${payloadSegment}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyLocalSessionToken(
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!isLocalAuthEnabled() || !token) return false;

  try {
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payloadSegment, signatureSegment] = parts;
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      toArrayBuffer(base64UrlToBytes(signatureSegment)),
      encoder.encode(payloadSegment),
    );
    if (!validSignature) return false;

    const payload = JSON.parse(
      decoder.decode(base64UrlToBytes(payloadSegment)),
    ) as Partial<LocalSessionPayload>;
    const nowSeconds = Math.floor(now / 1000);
    return (
      payload.v === 1 &&
      payload.sub === getLocalIdentity().userId &&
      typeof payload.iat === "number" &&
      typeof payload.exp === "number" &&
      payload.iat <= nowSeconds + 60 &&
      payload.exp > nowSeconds &&
      payload.exp - payload.iat === LOCAL_SESSION_TTL_SECONDS
    );
  } catch {
    return false;
  }
}
