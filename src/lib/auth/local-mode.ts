/** Client-safe build-time flag. Contains no credentials or session data. */
export const LOCAL_AUTH_CLIENT_ENABLED =
  process.env.NEXT_PUBLIC_LOCAL_AUTH_ENABLED === "true";
