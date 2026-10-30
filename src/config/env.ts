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
}).refine((value) => !(value.AUTH_BYPASS && value.NODE_ENV === 'production'), {
  message: 'AUTH_BYPASS must not be enabled when NODE_ENV=production',
  path: ['AUTH_BYPASS'],
});

export const env = envSchema.parse(process.env);