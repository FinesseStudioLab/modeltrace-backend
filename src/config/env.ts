import "dotenv/config";
import { z } from "zod";

const contractId = z
  .string()
  .regex(/^C[A-Z2-7]{55}$/, "must be a Soroban contract ID");

export const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8080),
  API_PREFIX: z.string().default("/api/v1"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  STELLAR_NETWORK: z.enum(["testnet", "futurenet", "mainnet"]),
  SOROBAN_RPC_URL: z.string().url(),
  AUDIT_REGISTRY_CONTRACT_ID: contractId,
  USAGE_METER_CONTRACT_ID: contractId,
  PAYMENT_ROUTER_CONTRACT_ID: contractId,

  // Signing key custody — see docs/adr/0001-soroban-signing-key-custody.md.
  // Defaults to "null": this service cannot sign until something deliberately
  // configures it to, and it never signs value movement at all.
  SIGNING_PROVIDER: z.enum(["null", "kms", "env"]).default("null"),
  SIGNING_KMS_KEY_ID: z.string().optional(),
  SIGNING_ENV_SECRET_KEY: z.string().optional(),
});

export function parseEnv(env: NodeJS.ProcessEnv) {
  return envSchema.parse(env);
}

const raw = parseEnv(process.env);

export const config = {
  nodeEnv: raw.NODE_ENV,
  port: raw.PORT,
  apiPrefix: raw.API_PREFIX,
  corsOrigin: raw.CORS_ORIGIN,
  stellar: {
    network: raw.STELLAR_NETWORK,
    sorobanRpcUrl: raw.SOROBAN_RPC_URL,
    contracts: {
      auditRegistry: raw.AUDIT_REGISTRY_CONTRACT_ID,
      usageMeter: raw.USAGE_METER_CONTRACT_ID,
      paymentRouter: raw.PAYMENT_ROUTER_CONTRACT_ID,
    },
  },
  signing: {
    provider: raw.SIGNING_PROVIDER,
    kmsKeyId: raw.SIGNING_KMS_KEY_ID,
    envSecret: raw.SIGNING_ENV_SECRET_KEY,
    nodeEnv: raw.NODE_ENV,
  },
};
