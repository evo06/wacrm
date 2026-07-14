import { NextResponse } from "next/server";

import { LOCAL_SESSION_COOKIE } from "@/lib/auth/local-session";

export async function POST() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(LOCAL_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
