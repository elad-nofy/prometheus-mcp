import { z } from 'zod';

const ConfigSchema = z.object({
  prometheusUrl: z.string().url('PROMETHEUS_URL must be a valid URL'),
  username: z.string().optional(),
  password: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const config = {
    prometheusUrl: process.env.PROMETHEUS_URL || '',
    username: process.env.PROMETHEUS_USERNAME || undefined,
    password: process.env.PROMETHEUS_PASSWORD || undefined,
  };

  // Remove trailing slash from URL if present
  if (config.prometheusUrl.endsWith('/')) {
    config.prometheusUrl = config.prometheusUrl.slice(0, -1);
  }

  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Configuration error:\n${errors}`);
  }

  return result.data;
}
