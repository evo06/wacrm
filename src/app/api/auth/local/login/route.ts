import { NextRequest, NextResponse } from "next/server";

import {
  createLocalSessionToken,
  isLocalAuthEnabled,
  LOCAL_SESSION_COOKIE,
  LOCAL_SESSION_TTL_SECONDS,
  verifyLocalCredentials,
} from "@/lib/auth/local-session";
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from "@/lib/rate-limit";

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

export async function POST(request: NextRequest) {
  if (!isLocalAuthEnabled()) {
    return NextResponse.json(
      { error: "O acesso local não está habilitado." },
      { status: 404 },
    );
  }

  const limit = checkRateLimit(
    `local-login:${clientIp(request)}`,
    RATE_LIMITS.localLogin,
  );
  if (!limit.success) return rateLimitResponse(limit);

  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Dados de acesso inválidos." }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await verifyLocalCredentials(username, password))) {
    return NextResponse.json(
      { error: "Usuário ou senha incorretos." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(LOCAL_SESSION_COOKIE, await createLocalSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: LOCAL_SESSION_TTL_SECONDS,
    path: "/",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
