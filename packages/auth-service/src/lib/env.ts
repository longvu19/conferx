const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

// Built from parts so special characters in the password are URL-encoded.
const buildDbUrl = (): string => {
  if (process.env.DB_URL) return process.env.DB_URL;
  const user = encodeURIComponent(process.env.DB_USER ?? "postgres");
  const password = encodeURIComponent(required("DB_PASSWORD"));
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const name = process.env.DB_NAME ?? "conferx_auth";
  return `postgresql://${user}:${password}@${host}:${port}/${name}`;
};

export const env = {
  port: Number(process.env.PORT ?? 3001),
  dbUrl: buildDbUrl(),
  // Shared with room-service, which verifies user access tokens.
  userJwtSecret: required("USER_JWT_SECRET"),
  accessTokenTtl: Number(process.env.USER_ACCESS_TOKEN_TTL ?? 15 * 60),
  refreshTokenTtl: Number(process.env.USER_REFRESH_TOKEN_TTL ?? 30 * 24 * 60 * 60),
  cookieSecure: process.env.COOKIE_SECURE !== "false",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
};
