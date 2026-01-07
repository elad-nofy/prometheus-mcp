import { z } from 'zod';
import type { PrometheusClient } from '../prometheusClient.js';

export const queryTools = {
  query_instant: {
    description: 'Execute a PromQL instant query to get the current value of metrics',
    inputSchema: z.object({
      query: z.string().describe('PromQL query expression'),
      time: z.string().optional().describe('Evaluation timestamp (RFC3339 or Unix timestamp). Default: current time'),
    }),
    handler: async (client: PrometheusClient, args: { query: string; time?: string }) => {
      const result = await client.queryInstant(args.query, args.time);

      return {
        resultType: result.resultType,
        resultCount: result.result.length,
        results: result.result.map(r => ({
          metric: r.metric,
          timestamp: new Date(r.value[0] * 1000).toISOString(),
          value: r.value[1],
        })),
      };
    },
  },

  query_range: {
    description: 'Execute a PromQL range query to get time series data over a time range',
    inputSchema: z.object({
      query: z.string().describe('PromQL query expression'),
      start: z.string().describe('Start time (RFC3339 or Unix timestamp, or relative like "1h" for 1 hour ago)'),
      end: z.string().optional().describe('End time (RFC3339 or Unix timestamp). Default: now'),
      step: z.string().optional().default('1m').describe('Query resolution step (e.g., "15s", "1m", "5m")'),
    }),
    handler: async (client: PrometheusClient, args: { query: string; start: string; end?: string; step?: string }) => {
      // Handle relative time for start (e.g., "1h" means 1 hour ago)
      let start = args.start;
      if (/^\d+[smhdw]$/.test(start)) {
        const match = start.match(/^(\d+)([smhdw])$/);
        if (match) {
          const value = parseInt(match[1]);
          const unit = match[2];
          const multipliers: Record<string, number> = {
            s: 1000,
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
            w: 7 * 24 * 60 * 60 * 1000,
          };
          const ms = value * multipliers[unit];
          start = new Date(Date.now() - ms).toISOString();
        }
      }

      const end = args.end || new Date().toISOString();
      const step = args.step || '1m';

      const result = await client.queryRange(args.query, start, end, step);

      return {
        resultType: result.resultType,
        resultCount: result.result.length,
        timeRange: { start, end, step },
        results: result.result.map(r => ({
          metric: r.metric,
          valueCount: r.values.length,
          values: r.values.map(v => ({
            timestamp: new Date(v[0] * 1000).toISOString(),
            value: v[1],
          })),
        })),
      };
    },
  },

  query_windows_exporter: {
    description: 'Query common Windows metrics from windows_exporter (CPU, memory, disk, etc.)',
    inputSchema: z.object({
      instance: z.string().describe('Windows server instance (hostname:port)'),
      metric: z.enum(['cpu', 'memory', 'disk', 'network', 'services', 'all']).describe('Type of metrics to query'),
      timeRange: z.string().optional().default('5m').describe('Time range for averaging (e.g., "5m", "1h")'),
    }),
    handler: async (client: PrometheusClient, args: { instance: string; metric: string; timeRange?: string }) => {
      const instance = args.instance;
      const range = args.timeRange || '5m';
      const queries: Record<string, string> = {};

      if (args.metric === 'cpu' || args.metric === 'all') {
        queries.cpuUsage = `100 - (avg by (instance) (rate(windows_cpu_time_total{instance="${instance}",mode="idle"}[${range}])) * 100)`;
      }

      if (args.metric === 'memory' || args.metric === 'all') {
        queries.memoryUsedBytes = `windows_os_physical_memory_free_bytes{instance="${instance}"}`;
        queries.memoryTotalBytes = `windows_cs_physical_memory_bytes{instance="${instance}"}`;
        queries.memoryUsedPercent = `100 - (windows_os_physical_memory_free_bytes{instance="${instance}"} / windows_cs_physical_memory_bytes{instance="${instance}"} * 100)`;
      }

      if (args.metric === 'disk' || args.metric === 'all') {
        queries.diskFreeBytes = `windows_logical_disk_free_bytes{instance="${instance}"}`;
        queries.diskUsedPercent = `100 - (windows_logical_disk_free_bytes{instance="${instance}"} / windows_logical_disk_size_bytes{instance="${instance}"} * 100)`;
      }

      if (args.metric === 'network' || args.metric === 'all') {
        queries.networkBytesReceived = `rate(windows_net_bytes_received_total{instance="${instance}"}[${range}])`;
        queries.networkBytesSent = `rate(windows_net_bytes_sent_total{instance="${instance}"}[${range}])`;
      }

      if (args.metric === 'services' || args.metric === 'all') {
        queries.servicesRunning = `windows_service_state{instance="${instance}",state="running"}`;
        queries.servicesStopped = `windows_service_state{instance="${instance}",state="stopped"}`;
      }

      const results: Record<string, unknown> = {};

      for (const [name, query] of Object.entries(queries)) {
        try {
          const result = await client.queryInstant(query);
          results[name] = result.result.map(r => ({
            labels: r.metric,
            value: r.value[1],
          }));
        } catch (error) {
          results[name] = { error: error instanceof Error ? error.message : 'Query failed' };
        }
      }

      return {
        instance,
        timeRange: range,
        metrics: results,
      };
    },
  },

  query_blackbox_exporter: {
    description: 'Query probe results from blackbox_exporter for endpoint monitoring',
    inputSchema: z.object({
      target: z.string().optional().describe('Filter by target URL'),
      module: z.string().optional().describe('Filter by probe module (http, tcp, icmp, etc.)'),
    }),
    handler: async (client: PrometheusClient, args: { target?: string; module?: string }) => {
      let query = 'probe_success';
      const filters: string[] = [];

      if (args.target) {
        filters.push(`target="${args.target}"`);
      }
      if (args.module) {
        filters.push(`module="${args.module}"`);
      }

      if (filters.length > 0) {
        query = `probe_success{${filters.join(',')}}`;
      }

      const successResult = await client.queryInstant(query);

      // Also get probe duration
      let durationQuery = 'probe_duration_seconds';
      if (filters.length > 0) {
        durationQuery = `probe_duration_seconds{${filters.join(',')}}`;
      }

      let durationResult;
      try {
        durationResult = await client.queryInstant(durationQuery);
      } catch {
        durationResult = { result: [] };
      }

      // Combine results
      const probes = successResult.result.map(r => {
        const duration = durationResult.result.find(
          d => d.metric.instance === r.metric.instance && d.metric.target === r.metric.target
        );

        return {
          target: r.metric.target,
          instance: r.metric.instance,
          module: r.metric.module,
          job: r.metric.job,
          success: r.value[1] === '1',
          durationSeconds: duration ? parseFloat(duration.value[1]) : null,
        };
      });

      return {
        summary: {
          total: probes.length,
          up: probes.filter(p => p.success).length,
          down: probes.filter(p => !p.success).length,
        },
        probes,
      };
    },
  },

  query_node_exporter: {
    description: 'Query common Linux metrics from node_exporter (CPU, memory, disk, network, load)',
    inputSchema: z.object({
      instance: z.string().describe('Linux server instance (hostname:port)'),
      metric: z.enum(['cpu', 'memory', 'disk', 'network', 'load', 'filesystem', 'all']).describe('Type of metrics to query'),
      timeRange: z.string().optional().default('5m').describe('Time range for rate calculations (e.g., "5m", "1h")'),
    }),
    handler: async (client: PrometheusClient, args: { instance: string; metric: string; timeRange?: string }) => {
      const instance = args.instance;
      const range = args.timeRange || '5m';
      const queries: Record<string, string> = {};

      if (args.metric === 'cpu' || args.metric === 'all') {
        queries.cpuUsagePercent = `100 - (avg by (instance) (rate(node_cpu_seconds_total{instance="${instance}",mode="idle"}[${range}])) * 100)`;
        queries.cpuUserPercent = `avg by (instance) (rate(node_cpu_seconds_total{instance="${instance}",mode="user"}[${range}])) * 100`;
        queries.cpuSystemPercent = `avg by (instance) (rate(node_cpu_seconds_total{instance="${instance}",mode="system"}[${range}])) * 100`;
        queries.cpuIowaitPercent = `avg by (instance) (rate(node_cpu_seconds_total{instance="${instance}",mode="iowait"}[${range}])) * 100`;
      }

      if (args.metric === 'memory' || args.metric === 'all') {
        queries.memoryTotalBytes = `node_memory_MemTotal_bytes{instance="${instance}"}`;
        queries.memoryAvailableBytes = `node_memory_MemAvailable_bytes{instance="${instance}"}`;
        queries.memoryUsedPercent = `100 - (node_memory_MemAvailable_bytes{instance="${instance}"} / node_memory_MemTotal_bytes{instance="${instance}"} * 100)`;
        queries.swapUsedPercent = `100 - (node_memory_SwapFree_bytes{instance="${instance}"} / node_memory_SwapTotal_bytes{instance="${instance}"} * 100)`;
      }

      if (args.metric === 'disk' || args.metric === 'all') {
        queries.diskReadBytesPerSec = `rate(node_disk_read_bytes_total{instance="${instance}"}[${range}])`;
        queries.diskWriteBytesPerSec = `rate(node_disk_written_bytes_total{instance="${instance}"}[${range}])`;
        queries.diskIOUtilization = `rate(node_disk_io_time_seconds_total{instance="${instance}"}[${range}]) * 100`;
      }

      if (args.metric === 'filesystem' || args.metric === 'all') {
        queries.filesystemUsedPercent = `100 - (node_filesystem_avail_bytes{instance="${instance}",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{instance="${instance}",fstype!~"tmpfs|overlay"} * 100)`;
        queries.filesystemAvailableBytes = `node_filesystem_avail_bytes{instance="${instance}",fstype!~"tmpfs|overlay"}`;
      }

      if (args.metric === 'network' || args.metric === 'all') {
        queries.networkReceiveBytesPerSec = `rate(node_network_receive_bytes_total{instance="${instance}",device!~"lo|veth.*|docker.*|br-.*"}[${range}])`;
        queries.networkTransmitBytesPerSec = `rate(node_network_transmit_bytes_total{instance="${instance}",device!~"lo|veth.*|docker.*|br-.*"}[${range}])`;
        queries.networkReceiveErrors = `rate(node_network_receive_errs_total{instance="${instance}"}[${range}])`;
        queries.networkTransmitErrors = `rate(node_network_transmit_errs_total{instance="${instance}"}[${range}])`;
      }

      if (args.metric === 'load' || args.metric === 'all') {
        queries.load1 = `node_load1{instance="${instance}"}`;
        queries.load5 = `node_load5{instance="${instance}"}`;
        queries.load15 = `node_load15{instance="${instance}"}`;
        queries.cpuCount = `count(node_cpu_seconds_total{instance="${instance}",mode="idle"})`;
      }

      const results: Record<string, unknown> = {};

      for (const [name, query] of Object.entries(queries)) {
        try {
          const result = await client.queryInstant(query);
          results[name] = result.result.map(r => ({
            labels: r.metric,
            value: r.value[1],
          }));
        } catch (error) {
          results[name] = { error: error instanceof Error ? error.message : 'Query failed' };
        }
      }

      return {
        instance,
        timeRange: range,
        metrics: results,
      };
    },
  },
};
