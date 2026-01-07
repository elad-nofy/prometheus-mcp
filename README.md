# Prometheus MCP Server

A **READ-ONLY** MCP (Model Context Protocol) server that connects AI assistants to Prometheus. Works with Claude Code CLI, VS Code AI extensions (Continue, Cline), Cursor, Amazon Q Developer, and any MCP-compatible client.

## Features

- **Health Monitoring**: Check target status, scrape health
- **PromQL Queries**: Execute instant and range queries
- **Metrics Discovery**: List and search available metrics
- **Alerting**: View active alerts and alerting rules
- **Exporter Helpers**: Pre-built queries for windows_exporter and blackbox_exporter

## Prerequisites

- Node.js 18 or higher
- Prometheus server (accessible via HTTP API)

## Installation

### Option 1: npm (Recommended)

```bash
npx prometheus-mcp@latest
```

### Option 2: Clone and Build

```bash
git clone https://github.com/elad-nofy/prometheus-mcp.git
cd prometheus-mcp
npm install
npm run build
```

## Configuration

### Configure MCP Client

#### Claude Code CLI

Add to your global settings (`~/.claude.json` on macOS/Linux, `%USERPROFILE%\.claude.json` on Windows):

**Windows:**
```json
{
  "mcpServers": {
    "prometheus": {
      "command": "cmd",
      "args": ["/c", "npx", "prometheus-mcp"],
      "env": {
        "PROMETHEUS_URL": "http://your-prometheus-server:9090"
      }
    }
  }
}
```

**macOS / Linux:**
```json
{
  "mcpServers": {
    "prometheus": {
      "command": "npx",
      "args": ["prometheus-mcp"],
      "env": {
        "PROMETHEUS_URL": "http://your-prometheus-server:9090"
      }
    }
  }
}
```

#### Amazon Q Developer

Add to `%USERPROFILE%\.aws\amazonq\agents\mcp.json`:

```json
{
  "mcpServers": {
    "prometheus": {
      "command": "cmd",
      "args": ["/c", "npx", "prometheus-mcp"],
      "env": {
        "PROMETHEUS_URL": "http://your-prometheus-server:9090"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PROMETHEUS_URL` | Yes | Prometheus server URL (e.g., `http://prometheus:9090`) |
| `PROMETHEUS_USERNAME` | No | Basic auth username |
| `PROMETHEUS_PASSWORD` | No | Basic auth password |

## Available Tools

### Health & Targets
| Tool | Description |
|------|-------------|
| `test_connection` | Test connection to Prometheus |
| `list_targets` | List all scrape targets and health status |
| `get_target_health` | Get health of specific target by job/instance |

### Queries
| Tool | Description |
|------|-------------|
| `query_instant` | Execute PromQL instant query (current value) |
| `query_range` | Execute PromQL range query (time series) |
| `query_windows_exporter` | Query Windows server metrics (CPU, memory, disk, network, services) |
| `query_node_exporter` | Query Linux server metrics (CPU, memory, disk, network, load, filesystem) |
| `query_blackbox_exporter` | Query endpoint probe results |

### Metrics
| Tool | Description |
|------|-------------|
| `list_metrics` | List all available metric names |
| `get_metric_metadata` | Get metric type and help text |
| `get_label_values` | Get all values for a label |
| `find_series` | Find time series matching a selector |

### Alerts & Rules
| Tool | Description |
|------|-------------|
| `list_alerts` | List firing/pending alerts |
| `get_alert_rules` | Get alerting rules and states |
| `get_alert_history` | Query alert state changes over time |
| `get_recording_rules` | Get recording rules (pre-computed queries) |

### Status & Info
| Tool | Description |
|------|-------------|
| `get_prometheus_status` | Get Prometheus version, runtime info, config, and flags |
| `get_tsdb_status` | Get TSDB statistics (cardinality, memory usage, top metrics) |

## Usage Examples

Once configured, you can ask your AI assistant questions like:

- "Are all Prometheus targets healthy?"
- "Show me the CPU usage of server1 over the last hour"
- "What alerts are currently firing?"
- "List all metrics containing 'http'"
- "Check the memory usage on my Windows servers"
- "What's the load average on my Linux servers?"
- "Is the website responding? Check blackbox_exporter"
- "What version of Prometheus is running?"
- "Show me the top metrics by cardinality"
- "What recording rules are configured?"

### Example Queries

**Check target health:**
```
What's the health status of all Prometheus targets?
```

**Query CPU usage:**
```
Show me the CPU usage on instance "server1:9182" for the last 30 minutes
```

**Find metrics:**
```
List all metrics related to HTTP requests
```

**Check alerts:**
```
Are there any firing alerts? Show me the details
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev
```

## Troubleshooting

### Connection errors
- Verify `PROMETHEUS_URL` is correct and accessible
- Check if basic auth is required and credentials are correct
- Ensure your network allows connection to the Prometheus server

### Query errors
- Verify the PromQL syntax is correct
- Check if the metric exists using `list_metrics`
- Ensure the time range is valid

### No data returned
- Verify the target is being scraped
- Check if the metric has data for the requested time range
- Use `list_targets` to verify scrape status

## License

MIT
