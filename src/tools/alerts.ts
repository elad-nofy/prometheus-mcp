import { z } from 'zod';
import type { PrometheusClient } from '../prometheusClient.js';

export const alertsTools = {
  list_alerts: {
    description: 'List all currently firing or pending alerts',
    inputSchema: z.object({
      state: z.enum(['firing', 'pending', 'all']).optional().default('all').describe('Filter by alert state'),
    }),
    handler: async (client: PrometheusClient, args: { state?: string }) => {
      const alerts = await client.getAlerts();

      let filtered = alerts;
      if (args.state && args.state !== 'all') {
        filtered = alerts.filter(a => a.state === args.state);
      }

      return {
        summary: {
          total: alerts.length,
          firing: alerts.filter(a => a.state === 'firing').length,
          pending: alerts.filter(a => a.state === 'pending').length,
        },
        alerts: filtered.map(a => ({
          alertname: a.labels.alertname,
          state: a.state,
          severity: a.labels.severity,
          instance: a.labels.instance,
          job: a.labels.job,
          summary: a.annotations.summary,
          description: a.annotations.description,
          activeAt: a.activeAt,
          value: a.value,
          labels: a.labels,
        })),
      };
    },
  },

  get_alert_rules: {
    description: 'Get all alerting rules and their current states',
    inputSchema: z.object({
      group: z.string().optional().describe('Filter by rule group name'),
      state: z.enum(['firing', 'pending', 'inactive', 'all']).optional().default('all').describe('Filter by rule state'),
    }),
    handler: async (client: PrometheusClient, args: { group?: string; state?: string }) => {
      const rulesResponse = await client.getRules();

      let groups = rulesResponse.groups;

      // Filter by group name
      if (args.group) {
        groups = groups.filter(g => g.name === args.group);
      }

      // Count states
      const stateCounts = { firing: 0, pending: 0, inactive: 0 };

      const formattedGroups = groups.map(g => {
        let rules = g.rules.filter(r => r.type === 'alerting');

        // Filter by state
        if (args.state && args.state !== 'all') {
          rules = rules.filter(r => r.state === args.state);
        }

        rules.forEach(r => {
          if (r.state in stateCounts) {
            stateCounts[r.state as keyof typeof stateCounts]++;
          }
        });

        return {
          name: g.name,
          file: g.file,
          interval: g.interval,
          rules: rules.map(r => ({
            name: r.name,
            state: r.state,
            health: r.health,
            query: r.query,
            duration: r.duration,
            labels: r.labels,
            annotations: r.annotations,
            lastEvaluation: r.lastEvaluation,
            evaluationTime: r.evaluationTime,
            lastError: r.lastError || null,
            activeAlerts: r.alerts.length,
          })),
        };
      });

      return {
        summary: {
          groups: groups.length,
          rules: stateCounts.firing + stateCounts.pending + stateCounts.inactive,
          ...stateCounts,
        },
        groups: formattedGroups,
      };
    },
  },

  get_alert_history: {
    description: 'Query alert state changes over time using ALERTS metric',
    inputSchema: z.object({
      alertname: z.string().optional().describe('Filter by alert name'),
      timeRange: z.string().optional().default('1h').describe('Time range to look back (e.g., "1h", "24h", "7d")'),
    }),
    handler: async (client: PrometheusClient, args: { alertname?: string; timeRange?: string }) => {
      const range = args.timeRange || '1h';

      // Parse time range
      const match = range.match(/^(\d+)([smhdw])$/);
      if (!match) {
        throw new Error('Invalid time range format. Use formats like "1h", "24h", "7d"');
      }

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
      const start = new Date(Date.now() - ms).toISOString();
      const end = new Date().toISOString();

      // Build query
      let query = 'ALERTS';
      if (args.alertname) {
        query = `ALERTS{alertname="${args.alertname}"}`;
      }

      // Determine appropriate step based on time range
      let step = '1m';
      if (ms > 24 * 60 * 60 * 1000) step = '5m';
      if (ms > 7 * 24 * 60 * 60 * 1000) step = '15m';

      const result = await client.queryRange(query, start, end, step);

      return {
        timeRange: { start, end, step },
        alertCount: result.result.length,
        alerts: result.result.map(r => ({
          alertname: r.metric.alertname,
          severity: r.metric.severity,
          instance: r.metric.instance,
          job: r.metric.job,
          stateChanges: r.values.length,
          firstSeen: r.values.length > 0 ? new Date(r.values[0][0] * 1000).toISOString() : null,
          lastSeen: r.values.length > 0 ? new Date(r.values[r.values.length - 1][0] * 1000).toISOString() : null,
          labels: r.metric,
        })),
      };
    },
  },

  get_recording_rules: {
    description: 'Get all recording rules (pre-computed queries) and their current states',
    inputSchema: z.object({
      group: z.string().optional().describe('Filter by rule group name'),
    }),
    handler: async (client: PrometheusClient, args: { group?: string }) => {
      const rulesResponse = await client.getRules();

      let groups = rulesResponse.groups;

      // Filter by group name
      if (args.group) {
        groups = groups.filter(g => g.name === args.group);
      }

      let totalRules = 0;
      let healthyRules = 0;
      let unhealthyRules = 0;

      const formattedGroups = groups.map(g => {
        // Filter for recording rules only (type !== 'alerting')
        const recordingRules = g.rules.filter(r => r.type !== 'alerting');

        recordingRules.forEach(r => {
          totalRules++;
          if (r.health === 'ok') {
            healthyRules++;
          } else {
            unhealthyRules++;
          }
        });

        return {
          name: g.name,
          file: g.file,
          interval: g.interval,
          rules: recordingRules.map(r => ({
            name: r.name,
            query: r.query,
            labels: r.labels,
            health: r.health,
            lastEvaluation: r.lastEvaluation,
            evaluationTime: r.evaluationTime,
            lastError: r.lastError || null,
          })),
        };
      }).filter(g => g.rules.length > 0);

      return {
        summary: {
          groups: formattedGroups.length,
          totalRules,
          healthy: healthyRules,
          unhealthy: unhealthyRules,
        },
        groups: formattedGroups,
      };
    },
  },
};
