import { z } from 'zod';

/**
 * Public environment, validated once at import time.
 *
 * Two deliberate choices:
 *
 * 1. Each variable is read as a *static* `process.env.NEXT_PUBLIC_X` expression.
 *    Next.js inlines these at build time by literal text substitution, so
 *    `schema.parse(process.env)` would compile to `undefined` in the browser.
 *
 * 2. The service-role/secret key is deliberately absent from this file. It is
 *    read only by scripts/seed.ts (plain Node). Nothing importable by a React
 *    component can reach it, so it cannot be leaked into a client bundle by a
 *    stray import.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_URL is missing')
    .url('NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. https://abc.supabase.co'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is missing'),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (!parsed.success) {
  // Fail loudly at boot rather than with a confusing runtime error later.
  const issues = parsed.error.issues.map((i) => `  - ${i.message}`).join('\n');
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\n` +
      `Copy .env.example to .env.local and fill it in from your Supabase project.`,
  );
}

export const env = parsed.data;
