import { z } from 'zod';
import type { PrometheusClient } from '../prometheusClient.js';

export const healthTools = {
  test_connection: {
    description: 'Test connection to Prometheus and verify it is accessible',
    inputSchema: z.object({}),
    handler: async (client: PrometheusClient) => {
      const result = await client.testConnection();
      return {
        status: result.status,
        version: result.version,
        url: process.env.PROMETHEUS_URL,
      };
    },
  },

  list_targets: {
    description: 'List all scrape targets and their health status (up/down)',
    inputSchema: z.object({
      health: z.enum(['up', 'down', 'unknown', 'all']).optional().default('all').describe('Filter by health status'),
    }),
    handler: async (client: PrometheusClient, args: { health?: string }) => {
      const targets = await client.getTargets();

      let activeTargets = targets.activeTargets;

      // Filter by health if specified
      if (args.health && args.health !== 'all') {
        activeTargets = activeTargets.filter(t => t.health === args.health);
      }

      return {
        summary: {
          total: targets.activeTargets.length,
          up: targets.activeTargets.filter(t => t.health === 'up').length,
          down: targets.activeTargets.filter(t => t.health === 'down').length,
          unknown: targets.activeTargets.filter(t => t.health === 'unknown').length,
          dropped: targets.droppedTargets.length,
        },
        activeTargets: activeTargets.map(t => ({
          job: t.labels.job,
          instance: t.labels.instance,
          health: t.health,
          lastScrape: t.lastScrape,
          lastScrapeDuration: t.lastScrapeDuration,
          lastError: t.lastError || null,
          scrapeUrl: t.scrapeUrl,
        })),
      };
    },
  },

  get_target_health: {
    description: 'Get health status of a specific target by job name and/or instance',
    inputSchema: z.object({
      job: z.string().optional().describe('Job name to filter'),
      instance: z.string().optional().describe('Instance (host:port) to filter'),
    }),
    handler: async (client: PrometheusClient, args: { job?: string; instance?: string }) => {
      if (!args.job && !args.instance) {
        throw new Error('At least one of job or instance must be specified');
      }

      const targets = await client.getTargets();

      const filtered = targets.activeTargets.filter(t => {
        if (args.job && t.labels.job !== args.job) return false;
        if (args.instance && t.labels.instance !== args.instance) return false;
        return true;
      });

      if (filtered.length === 0) {
        return { found: false, message: 'No matching targets found' };
      }

      return {
        found: true,
        targets: filtered.map(t => ({
          job: t.labels.job,
          instance: t.labels.instance,
          health: t.health,
          lastScrape: t.lastScrape,
          lastScrapeDuration: t.lastScrapeDuration,
          lastError: t.lastError || null,
          scrapeUrl: t.scrapeUrl,
          scrapeInterval: t.scrapeInterval,
          labels: t.labels,
        })),
      };
    },
  },
};
