import axios, { AxiosInstance, AxiosError } from 'axios';
import { Config } from './config.js';

export interface PrometheusResponse<T> {
  status: 'success' | 'error';
  data: T;
  errorType?: string;
  error?: string;
  warnings?: string[];
}

export interface InstantQueryResult {
  resultType: 'vector' | 'scalar' | 'string';
  result: Array<{
    metric: Record<string, string>;
    value: [number, string]; // [timestamp, value]
  }>;
}

export interface RangeQueryResult {
  resultType: 'matrix';
  result: Array<{
    metric: Record<string, string>;
    values: Array<[number, string]>; // [[timestamp, value], ...]
  }>;
}

export interface Target {
  discoveredLabels: Record<string, string>;
  labels: Record<string, string>;
  scrapePool: string;
  scrapeUrl: string;
  globalUrl: string;
  lastError: string;
  lastScrape: string;
  lastScrapeDuration: number;
  health: 'up' | 'down' | 'unknown';
  scrapeInterval: string;
  scrapeTimeout: string;
}

export interface TargetsResponse {
  activeTargets: Target[];
  droppedTargets: Array<{
    discoveredLabels: Record<string, string>;
  }>;
}

export interface AlertRule {
  name: string;
  query: string;
  duration: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  alerts: Array<{
    labels: Record<string, string>;
    annotations: Record<string, string>;
    state: 'firing' | 'pending' | 'inactive';
    activeAt: string;
    value: string;
  }>;
  health: string;
  lastError: string;
  evaluationTime: number;
  lastEvaluation: string;
  state: 'firing' | 'pending' | 'inactive';
  type: 'alerting';
}

export interface RuleGroup {
  name: string;
  file: string;
  rules: AlertRule[];
  interval: number;
  evaluationTime: number;
  lastEvaluation: string;
}

export interface RulesResponse {
  groups: RuleGroup[];
}

export interface Alert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing' | 'pending';
  activeAt: string;
  value: string;
}

export interface MetricMetadata {
  type: 'counter' | 'gauge' | 'histogram' | 'summary' | 'unknown';
  help: string;
  unit: string;
}

export interface BuildInfo {
  version: string;
  revision: string;
  branch: string;
  buildUser: string;
  buildDate: string;
  goVersion: string;
}

export interface RuntimeInfo {
  startTime: string;
  CWD: string;
  reloadConfigSuccess: boolean;
  lastConfigTime: string;
  corruptionCount: number;
  goroutineCount: number;
  GOMAXPROCS: number;
  GOMEMLIMIT: number;
  GOGC: string;
  GODEBUG: string;
  storageRetention: string;
}

export interface TsdbStatus {
  headStats: {
    numSeries: number;
    numLabelPairs: number;
    chunkCount: number;
    minTime: number;
    maxTime: number;
  };
  seriesCountByMetricName: Array<{ name: string; value: number }>;
  labelValueCountByLabelName: Array<{ name: string; value: number }>;
  memoryInBytesByLabelName: Array<{ name: string; value: number }>;
  seriesCountByLabelValuePair: Array<{ name: string; value: number }>;
}

export interface RecordingRule {
  name: string;
  query: string;
  labels: Record<string, string>;
  health: string;
  lastError: string;
  evaluationTime: number;
  lastEvaluation: string;
  type: 'recording';
}

export class PrometheusClient {
  private client: AxiosInstance;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    const axiosConfig: {
      baseURL: string;
      timeout: number;
      auth?: { username: string; password: string };
    } = {
      baseURL: config.prometheusUrl,
      timeout: 30000,
    };

    // Add basic auth if credentials provided
    if (config.username && config.password) {
      axiosConfig.auth = {
        username: config.username,
        password: config.password,
      };
    }

    this.client = axios.create(axiosConfig);
  }

  private handleError(error: unknown): never {
    if (error instanceof AxiosError) {
      if (error.response) {
        const data = error.response.data as PrometheusResponse<unknown>;
        throw new Error(`Prometheus API error: ${data.error || error.message} (${data.errorType || error.response.status})`);
      } else if (error.request) {
        throw new Error(`Cannot connect to Prometheus at ${this.config.prometheusUrl}: ${error.message}`);
      }
    }
    throw error;
  }

  async testConnection(): Promise<{ status: string; version?: string }> {
    try {
      // Try to get build info
      const response = await this.client.get<PrometheusResponse<{ version: string }>>('/api/v1/status/buildinfo');
      return {
        status: 'connected',
        version: response.data.data?.version,
      };
    } catch (error) {
      // If buildinfo fails, try a simple query
      try {
        await this.client.get('/api/v1/query', { params: { query: 'up' } });
        return { status: 'connected' };
      } catch {
        this.handleError(error);
      }
    }
  }

  async queryInstant(query: string, time?: string): Promise<InstantQueryResult> {
    try {
      const params: Record<string, string> = { query };
      if (time) params.time = time;

      const response = await this.client.get<PrometheusResponse<InstantQueryResult>>('/api/v1/query', { params });

      if (response.data.status !== 'success') {
        throw new Error(`Query failed: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async queryRange(
    query: string,
    start: string,
    end: string,
    step: string
  ): Promise<RangeQueryResult> {
    try {
      const response = await this.client.get<PrometheusResponse<RangeQueryResult>>('/api/v1/query_range', {
        params: { query, start, end, step },
      });

      if (response.data.status !== 'success') {
        throw new Error(`Query failed: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getTargets(): Promise<TargetsResponse> {
    try {
      const response = await this.client.get<PrometheusResponse<TargetsResponse>>('/api/v1/targets');

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get targets: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getMetrics(): Promise<string[]> {
    try {
      const response = await this.client.get<PrometheusResponse<string[]>>('/api/v1/label/__name__/values');

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get metrics: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getMetricMetadata(metric?: string): Promise<Record<string, MetricMetadata[]>> {
    try {
      const params: Record<string, string> = {};
      if (metric) params.metric = metric;

      const response = await this.client.get<PrometheusResponse<Record<string, MetricMetadata[]>>>('/api/v1/metadata', { params });

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get metadata: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getAlerts(): Promise<Alert[]> {
    try {
      const response = await this.client.get<PrometheusResponse<{ alerts: Alert[] }>>('/api/v1/alerts');

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get alerts: ${response.data.error}`);
      }

      return response.data.data.alerts;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getRules(): Promise<RulesResponse> {
    try {
      const response = await this.client.get<PrometheusResponse<RulesResponse>>('/api/v1/rules');

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get rules: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getLabelValues(label: string): Promise<string[]> {
    try {
      const response = await this.client.get<PrometheusResponse<string[]>>(`/api/v1/label/${encodeURIComponent(label)}/values`);

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get label values: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getSeries(match: string[], start?: string, end?: string): Promise<Array<Record<string, string>>> {
    try {
      const params: Record<string, string | string[]> = { 'match[]': match };
      if (start) params.start = start;
      if (end) params.end = end;

      const response = await this.client.get<PrometheusResponse<Array<Record<string, string>>>>('/api/v1/series', { params });

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get series: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getBuildInfo(): Promise<BuildInfo> {
    try {
      const response = await this.client.get<PrometheusResponse<BuildInfo>>('/api/v1/status/buildinfo');

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get build info: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getRuntimeInfo(): Promise<RuntimeInfo> {
    try {
      const response = await this.client.get<PrometheusResponse<RuntimeInfo>>('/api/v1/status/runtimeinfo');

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get runtime info: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getConfig(): Promise<string> {
    try {
      const response = await this.client.get<PrometheusResponse<{ yaml: string }>>('/api/v1/status/config');

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get config: ${response.data.error}`);
      }

      return response.data.data.yaml;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getFlags(): Promise<Record<string, string>> {
    try {
      const response = await this.client.get<PrometheusResponse<Record<string, string>>>('/api/v1/status/flags');

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get flags: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getTsdbStatus(): Promise<TsdbStatus> {
    try {
      const response = await this.client.get<PrometheusResponse<TsdbStatus>>('/api/v1/status/tsdb');

      if (response.data.status !== 'success') {
        throw new Error(`Failed to get TSDB status: ${response.data.error}`);
      }

      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }
}
