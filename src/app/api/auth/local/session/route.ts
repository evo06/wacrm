import { NextRequest, NextResponse } from "next/server";

import {
  getLocalIdentity,
  isLocalAuthEnabled,
  LOCAL_SESSION_COOKIE,
  verifyLocalSessionToken,
} from "@/lib/auth/local-session";

export async function GET(request: NextRequest) {
  const authenticated =
    isLocalAuthEnabled() &&
    (await verifyLocalSessionToken(
      request.cookies.get(LOCAL_SESSION_COOKIE)?.value,
    ));

  const response = NextResponse.json(
    authenticated
      ? { authenticated: true, identity: getLocalIdentity() }
      : { authenticated: false },
    { status: authenticated ? 200 : 401 },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
