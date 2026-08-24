import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8080),
  API_PREFIX: z.string().default("/api/v1"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // Signing key custody — see docs/adr/0001-soroban-signing-key-custody.md.
  // Defaults to "null": this service cannot sign until something deliberately
  // configures it to, and it never signs value movement at all.
  SIGNING_PROVIDER: z.enum(["null", "kms", "env"]).default("null"),
  SIGNING_KMS_KEY_ID: z.string().optional(),
  SIGNING_ENV_SECRET_KEY: z.string().optional(),
});

const raw = schema.parse(process.env);

export const config = {
  nodeEnv: raw.NODE_ENV,
  port: raw.PORT,
  apiPrefix: raw.API_PREFIX,
  corsOrigin: raw.CORS_ORIGIN,
  signing: {
    provider: raw.SIGNING_PROVIDER,
    kmsKeyId: raw.SIGNING_KMS_KEY_ID,
    envSecret: raw.SIGNING_ENV_SECRET_KEY,
    nodeEnv: raw.NODE_ENV,
  },
};
