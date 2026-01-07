#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { loadConfig } from './config.js';
import { PrometheusClient } from './prometheusClient.js';
import {
  healthTools,
  queryTools,
  metricsTools,
  alertsTools,
  statusTools,
} from './tools/index.js';

// Combine all tools
const allTools = {
  ...healthTools,
  ...queryTools,
  ...metricsTools,
  ...alertsTools,
  ...statusTools,
};

type ToolName = keyof typeof allTools;

async function main(): Promise<void> {
  // Load configuration
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    console.error('\nPlease set the required environment variables:');
    console.error('  PROMETHEUS_URL - Your Prometheus server URL (e.g., http://prometheus:9090)');
    console.error('  PROMETHEUS_USERNAME - (Optional) Basic auth username');
    console.error('  PROMETHEUS_PASSWORD - (Optional) Basic auth password');
    process.exit(1);
  }

  // Create Prometheus client
  const prometheusClient = new PrometheusClient(config);

  // Create MCP server
  const server = new Server(
    {
      name: 'prometheus-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [];

    for (const [name, tool] of Object.entries(allTools)) {
      let inputSchema: Record<string, unknown> = { type: 'object', properties: {} };

      if (tool.inputSchema) {
        const fullSchema = zodToJsonSchema(tool.inputSchema as z.ZodTypeAny, {
          $refStrategy: 'none',
        }) as Record<string, unknown>;
        // Remove $schema as MCP doesn't need it
        const { $schema, ...schema } = fullSchema;
        inputSchema = schema;
      }

      tools.push({
        name,
        description: tool.description,
        inputSchema: inputSchema as Tool['inputSchema'],
      });
    }

    return { tools };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!(name in allTools)) {
      return {
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${name}`,
          },
        ],
        isError: true,
      };
    }

    const tool = allTools[name as ToolName];

    try {
      // Validate input if schema exists
      let validatedArgs = args || {};
      if (tool.inputSchema) {
        const parseResult = (tool.inputSchema as z.ZodTypeAny).safeParse(args);
        if (!parseResult.success) {
          return {
            content: [
              {
                type: 'text',
                text: `Invalid arguments: ${parseResult.error.message}`,
              },
            ],
            isError: true,
          };
        }
        validatedArgs = parseResult.data;
      }

      // Execute tool
      const result = await tool.handler(prometheusClient, validatedArgs as never);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error executing ${name}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Prometheus MCP Server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
