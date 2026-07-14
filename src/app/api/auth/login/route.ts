import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { isLocalAuthEnabled } from "@/lib/auth/local-session";
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

async function credentials(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  const fromForm = contentType.includes("application/x-www-form-urlencoded");

  if (fromForm) {
    const body = await request.formData();
    const email = body.get("email");
    const password = body.get("password");
    return {
      email: typeof email === "string" ? email : "",
      password: typeof password === "string" ? password : "",
      fromForm,
    };
  }

  const body = (await request.json()) as { email?: unknown; password?: unknown };
  return {
    email: typeof body.email === "string" ? body.email : "",
    password: typeof body.password === "string" ? body.password : "",
    fromForm,
  };
}

export async function POST(request: NextRequest) {
  if (isLocalAuthEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limit = checkRateLimit(`supabase-login:${clientIp(request)}`, RATE_LIMITS.localLogin);
  if (!limit.success) return rateLimitResponse(limit);

  let input: Awaited<ReturnType<typeof credentials>>;
  try {
    input = await credentials(request);
  } catch {
    return NextResponse.json({ error: "Dados de acesso inválidos." }, { status: 400 });
  }

  if (!input.email || !input.password) {
    return NextResponse.json({ error: "E-mail e senha são obrigatórios." }, { status: 400 });
  }

  const cookiesToSet: Array<{
    name: string;
    value: string;
    options: Parameters<NextResponse["cookies"]["set"]>[2];
  }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookiesToSet.push(...cookies);
        },
      },
    },
  );

  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) {
    if (input.fromForm) {
      return new NextResponse(null, {
        status: 303,
        headers: { Location: "/login?error=invalid-credentials" },
      });
    }
    return NextResponse.json(
      { error: "E-mail ou senha incorretos." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = input.fromForm
    ? new NextResponse(null, {
        status: 303,
        headers: { Location: "/dashboard" },
      })
    : NextResponse.json({ authenticated: true });

  cookiesToSet.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
