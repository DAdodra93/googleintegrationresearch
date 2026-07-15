import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().default(8080),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8080'),
  DATABASE_URL: z.string().optional(),
  TOKEN_ENC_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENC_KEY must be 64 hex chars (32 bytes)')
    .optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ADS_DEVELOPER_TOKEN: z.string().optional(),
  ADS_MCC_CUSTOMER_ID: z.string().regex(/^\d+$/).optional(),
  ADS_MCC_REFRESH_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  BILLING_MODEL: z.enum(['interim', 'invoiced']).default('interim'),
  OPERATOR_EMAILS: z.string().default(''),
  DEFAULT_COUNTRY: z.string().length(2).default('IN'),
  DEFAULT_CURRENCY: z.string().length(3).default('INR'),
});

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  databaseUrl?: string;
  /** 32-byte key for token encryption + OAuth state signing. Ephemeral if not configured. */
  encKey: Buffer;
  encKeyIsEphemeral: boolean;
  google: { clientId?: string; clientSecret?: string; stub: boolean };
  ads: { developerToken?: string; mccCustomerId?: string; mccRefreshToken?: string; configured: boolean };
  ai: { openaiApiKey?: string; model: string; stub: boolean };
  billingModel: 'interim' | 'invoiced';
  defaults: { country: string; currency: string };
  /** Emails that get the operator role on signup (first signup is operator regardless). */
  operatorEmails: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = Env.parse(env);
  const googleStub = !(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
  const aiStub = !e.OPENAI_API_KEY;
  return {
    port: e.PORT,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ''),
    databaseUrl: e.DATABASE_URL,
    encKey: e.TOKEN_ENC_KEY ? Buffer.from(e.TOKEN_ENC_KEY, 'hex') : randomBytes(32),
    encKeyIsEphemeral: !e.TOKEN_ENC_KEY,
    google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET, stub: googleStub },
    ads: {
      developerToken: e.ADS_DEVELOPER_TOKEN,
      mccCustomerId: e.ADS_MCC_CUSTOMER_ID,
      mccRefreshToken: e.ADS_MCC_REFRESH_TOKEN,
      configured: Boolean(e.ADS_DEVELOPER_TOKEN && e.ADS_MCC_CUSTOMER_ID && e.ADS_MCC_REFRESH_TOKEN),
    },
    ai: { openaiApiKey: e.OPENAI_API_KEY, model: e.OPENAI_MODEL, stub: aiStub },
    billingModel: e.BILLING_MODEL,
    defaults: { country: e.DEFAULT_COUNTRY, currency: e.DEFAULT_CURRENCY },
    operatorEmails: e.OPERATOR_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}
