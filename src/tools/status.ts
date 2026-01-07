import { z } from 'zod';
import type { PrometheusClient } from '../prometheusClient.js';

export const statusTools = {
  get_prometheus_status: {
    description: 'Get Prometheus server status including version, runtime info, and configuration',
    inputSchema: z.object({
      include: z.enum(['all', 'build', 'runtime', 'config', 'flags']).optional().default('all').describe('What information to include'),
    }),
    handler: async (client: PrometheusClient, args: { include?: string }) => {
      const include = args.include || 'all';
      const result: Record<string, unknown> = {};

      if (include === 'all' || include === 'build') {
        try {
          result.build = await client.getBuildInfo();
        } catch (error) {
          result.build = { error: error instanceof Error ? error.message : 'Failed to get build info' };
        }
      }

      if (include === 'all' || include === 'runtime') {
        try {
          result.runtime = await client.getRuntimeInfo();
        } catch (error) {
          result.runtime = { error: error instanceof Error ? error.message : 'Failed to get runtime info' };
        }
      }

      if (include === 'all' || include === 'config') {
        try {
          const config = await client.getConfig();
          // Return first 2000 chars of config to avoid overwhelming response
          result.config = config.length > 2000
            ? { yaml: config.substring(0, 2000) + '\n... (truncated)', fullLength: config.length }
            : { yaml: config };
        } catch (error) {
          result.config = { error: error instanceof Error ? error.message : 'Failed to get config' };
        }
      }

      if (include === 'all' || include === 'flags') {
        try {
          result.flags = await client.getFlags();
        } catch (error) {
          result.flags = { error: error instanceof Error ? error.message : 'Failed to get flags' };
        }
      }

      return result;
    },
  },

  get_tsdb_status: {
    description: 'Get Prometheus TSDB (Time Series Database) statistics including cardinality and memory usage',
    inputSchema: z.object({
      limit: z.number().optional().default(10).describe('Limit for top series/labels lists'),
    }),
    handler: async (client: PrometheusClient, args: { limit?: number }) => {
      const tsdb = await client.getTsdbStatus();
      const limit = args.limit || 10;

      return {
        headStats: {
          numSeries: tsdb.headStats.numSeries,
          numLabelPairs: tsdb.headStats.numLabelPairs,
          chunkCount: tsdb.headStats.chunkCount,
          minTime: new Date(tsdb.headStats.minTime).toISOString(),
          maxTime: new Date(tsdb.headStats.maxTime).toISOString(),
        },
        topMetricsBySeriesCount: tsdb.seriesCountByMetricName?.slice(0, limit) || [],
        topLabelsByValueCount: tsdb.labelValueCountByLabelName?.slice(0, limit) || [],
        topLabelsByMemoryUsage: tsdb.memoryInBytesByLabelName?.slice(0, limit).map(l => ({
          name: l.name,
          bytes: l.value,
          humanReadable: formatBytes(l.value),
        })) || [],
        topLabelValuePairs: tsdb.seriesCountByLabelValuePair?.slice(0, limit) || [],
      };
    },
  },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
