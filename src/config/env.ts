import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  AUTH_BYPASS: z.string().transform((v) => v === 'true').default('false'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1).default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_SESSION_TOKEN: z.string().min(1).optional(),
  SQS_QUEUE_URL: z.string().url(),
  SES_CONFIGURATION_SET: z.string().min(1).default('email-config'),
  INTERNAL_KEY: z.string().min(32),
  PLATFORM_FROM_EMAIL: z.string().email(),
  PLATFORM_FROM_NAME: z.string().min(1),
  BASE_URL: z.string().url(),
  // Domain poller and HTML purge. Leave on for a long-running server (EC2);
  // serverless deployments never start them anyway.
  RUN_BACKGROUND_JOBS: z.string().transform((v) => v !== 'false').default('true'),
  // Email OTP (/v1/otp). A separate queue lets the worker send codes without
  // waiting behind campaigns; it falls back to SQS_QUEUE_URL when unset.
  OTP_SQS_QUEUE_URL: z.string().url().optional(),
  // Separate domain for default OTP senders: <customer>.<OTP_SENDING_DOMAIN>.
  // Keep it apart from the main brand domain so OTP abuse cannot hurt it.
  OTP_SENDING_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/, 'OTP_SENDING_DOMAIN must be a bare domain like otp-mail.in')
    .optional(),
  // When set, each customer subdomain gets its own SES identity with DKIM
  // records written to this Route 53 zone. When unset, the parent domain's
  // SES identity covers every subdomain.
  OTP_ROUTE53_HOSTED_ZONE_ID: z.string().min(1).optional(),
  // HMAC key for stored code hashes. Defaults to one derived from INTERNAL_KEY.
  OTP_HMAC_KEY: z.string().min(32).optional(),
  // Where bounce-rate alerts for OTP mail go.
  OTP_ALERT_EMAIL: z.string().email().optional(),
}).refine((value) => !(value.AUTH_BYPASS && value.NODE_ENV === 'production'), {
  message: 'AUTH_BYPASS must not be enabled when NODE_ENV=production',
  path: ['AUTH_BYPASS'],
});

// Treat empty values (e.g. `OTP_SENDING_DOMAIN=` in a Docker env file) as unset,
// so optional settings left blank don't fail validation and stop the API.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value.trim() !== ''),
);

export const env = envSchema.parse(rawEnv);