import { z } from 'zod';
import type { PrometheusClient } from '../prometheusClient.js';

export const metricsTools = {
  list_metrics: {
    description: 'List all available metric names in Prometheus',
    inputSchema: z.object({
      search: z.string().optional().describe('Filter metrics by substring (case-insensitive)'),
      limit: z.number().optional().default(100).describe('Maximum number of metrics to return'),
    }),
    handler: async (client: PrometheusClient, args: { search?: string; limit?: number }) => {
      const metrics = await client.getMetrics();

      let filtered = metrics;

      if (args.search) {
        const searchLower = args.search.toLowerCase();
        filtered = metrics.filter(m => m.toLowerCase().includes(searchLower));
      }

      const limit = args.limit || 100;
      const limited = filtered.slice(0, limit);

      return {
        total: metrics.length,
        matchingCount: filtered.length,
        returnedCount: limited.length,
        metrics: limited,
      };
    },
  },

  get_metric_metadata: {
    description: 'Get metadata (type, help text) for a specific metric or all metrics',
    inputSchema: z.object({
      metric: z.string().optional().describe('Metric name to get metadata for. If not specified, returns all metadata'),
    }),
    handler: async (client: PrometheusClient, args: { metric?: string }) => {
      const metadata = await client.getMetricMetadata(args.metric);

      if (args.metric) {
        const metricMeta = metadata[args.metric];
        if (!metricMeta || metricMeta.length === 0) {
          return { found: false, message: `No metadata found for metric: ${args.metric}` };
        }
        return {
          found: true,
          metric: args.metric,
          metadata: metricMeta[0],
        };
      }

      // Return summary of all metrics
      const summary = {
        total: Object.keys(metadata).length,
        byType: {
          counter: 0,
          gauge: 0,
          histogram: 0,
          summary: 0,
          unknown: 0,
        } as Record<string, number>,
      };

      for (const [, meta] of Object.entries(metadata)) {
        if (meta.length > 0) {
          const type = meta[0].type || 'unknown';
          summary.byType[type] = (summary.byType[type] || 0) + 1;
        }
      }

      return {
        summary,
        metrics: Object.entries(metadata)
          .slice(0, 50)
          .map(([name, meta]) => ({
            name,
            type: meta[0]?.type,
            help: meta[0]?.help,
          })),
      };
    },
  },

  get_label_values: {
    description: 'Get all values for a specific label (e.g., all job names, all instances)',
    inputSchema: z.object({
      label: z.string().describe('Label name (e.g., "job", "instance", "__name__")'),
    }),
    handler: async (client: PrometheusClient, args: { label: string }) => {
      const values = await client.getLabelValues(args.label);

      return {
        label: args.label,
        count: values.length,
        values: values.slice(0, 500), // Limit to 500 values
      };
    },
  },

  find_series: {
    description: 'Find time series matching a label selector',
    inputSchema: z.object({
      match: z.string().describe('Series selector (e.g., \'up{job="prometheus"}\', \'{__name__=~"http_.*"}\')'),
      start: z.string().optional().describe('Start time for the search'),
      end: z.string().optional().describe('End time for the search'),
    }),
    handler: async (client: PrometheusClient, args: { match: string; start?: string; end?: string }) => {
      const series = await client.getSeries([args.match], args.start, args.end);

      return {
        selector: args.match,
        count: series.length,
        series: series.slice(0, 100).map(s => ({
          metric: s.__name__,
          labels: s,
        })),
      };
    },
  },
};
