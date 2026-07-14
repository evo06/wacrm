import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createLocalSessionToken,
  LOCAL_SESSION_TTL_SECONDS,
  verifyLocalCredentials,
  verifyLocalSessionToken,
} from "./local-session";

const savedEnv = { ...process.env };

describe("local authentication", () => {
  beforeEach(() => {
    process.env.LOCAL_AUTH_ENABLED = "true";
    process.env.LOCAL_AUTH_USERNAME = "admin";
    process.env.LOCAL_AUTH_PASSWORD_SALT =
      "bG9jYWwtYXV0aC10ZXN0LXNhbHQ";
    process.env.LOCAL_AUTH_PASSWORD_HASH =
      "jWxbSxkqzyUlwM-fyj5jRRQq-jPEUSqKsMQF99xvm-Q";
    process.env.LOCAL_AUTH_SESSION_SECRET =
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("accepts the configured username and password", async () => {
    await expect(
      verifyLocalCredentials("admin", "correct-test-password"),
    ).resolves.toBe(true);
  });

  it("rejects incorrect credentials", async () => {
    await expect(verifyLocalCredentials("admin", "incorrect")).resolves.toBe(
      false,
    );
    await expect(
      verifyLocalCredentials("another-user", "correct-test-password"),
    ).resolves.toBe(false);
  });

  it("signs, validates and expires a local session", async () => {
    const now = Date.UTC(2026, 6, 13, 12, 0, 0);
    const token = await createLocalSessionToken(now);

    await expect(verifyLocalSessionToken(token, now)).resolves.toBe(true);
    await expect(
      verifyLocalSessionToken(
        token,
        now + (LOCAL_SESSION_TTL_SECONDS + 1) * 1000,
      ),
    ).resolves.toBe(false);
  });

  it("rejects a modified session", async () => {
    const token = await createLocalSessionToken();
    const modified = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    await expect(verifyLocalSessionToken(modified)).resolves.toBe(false);
  });
});
