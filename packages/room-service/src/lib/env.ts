// Centralised, validated configuration. Fails fast at startup instead of
// crashing on the first request (previously JWT_REFRESH_SECRET was undefined).
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

// Build the connection string from parts so special characters in the
// password (e.g. "@") are URL-encoded correctly. DB_URL still wins if set.
const buildDbUrl = (): string => {
  if (process.env.DB_URL) return process.env.DB_URL;
  const user = encodeURIComponent(process.env.DB_USER ?? "postgres");
  const password = encodeURIComponent(required("DB_PASSWORD"));
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const name = process.env.DB_NAME ?? "conferx_rooms";
  return `postgresql://${user}:${password}@${host}:${port}/${name}`;
};

export const env = {
  port: Number(process.env.PORT ?? 3002),
  dbUrl: buildDbUrl(),
  jwtSecret: required("JWT_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  accessTokenTtl: Number(process.env.ACCESS_TOKEN_TTL ?? 15 * 60),
  refreshTokenTtl: Number(process.env.REFRESH_TOKEN_TTL ?? 7 * 24 * 60 * 60),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  livekit: {
    apiKey: required("LIVEKIT_API_KEY"),
    apiSecret: required("LIVEKIT_API_SECRET"),
    // URL the service uses to reach LiveKit (inside docker network)
    internalUrl: process.env.LIVEKIT_INTERNAL_URL ?? "http://livekit:7880",
    // URL the browser uses to connect
    publicUrl: process.env.LIVEKIT_PUBLIC_URL ?? "ws://localhost:7880",
  },
};
