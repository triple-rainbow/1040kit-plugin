import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { defaultDeps, type Deps } from './deps.ts';
import { errorEnvelope, toCallToolResult } from './envelope.ts';
import { allTools } from './tools/index.ts';
import {
  INTERVIEW_WIDGET_URI,
  interviewWidgetHtml,
} from './ui/interview-widget.ts';

export const SERVER_NAME = '1040kit';
export const SERVER_VERSION = '0.1.1';

const INSTRUCTIONS = `1040kit prepares a US federal income tax return on this computer.
Rules: never do arithmetic or state tax law yourself — quote numbers from calc_return/explain_line and cite their citations or kb_search passages. 1040kit never stores SSNs, ITINs or bank account numbers: never ask for them in chat; the user writes them on the printed forms (forms_fill lists every box in "handwrite") or types them into Free File Fillable Forms. EINs appear only as tokens like {{EIN:w2_1}}. forms_fill needs the user's sign-off acknowledgment first (ACK_REQUIRED). Documents go in the workspace inbox, not the chat. This is not tax advice: the user is the preparer and signs the return.`;

export function createServer(deps: Deps = defaultDeps()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS }
  );
  for (const tool of allTools()) {
    const config = {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
    const run = async (args: Record<string, unknown>) => {
      try {
        return toCallToolResult(await tool.handler(args, deps));
      } catch (e) {
        return toCallToolResult(errorEnvelope(e));
      }
    };
    if (tool.ui) {
      registerAppTool(
        server,
        tool.name,
        { ...config, _meta: { ui: { resourceUri: tool.ui.resourceUri } } },
        run
      );
    } else {
      server.registerTool(tool.name, config, run);
    }
  }
  // MCP Apps widgets (hosts without MCP Apps never read these).
  registerAppResource(
    server,
    '1040kit interview questions',
    INTERVIEW_WIDGET_URI,
    { description: 'Interview questions with answer chips' },
    async () => ({
      contents: [
        {
          uri: INTERVIEW_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: interviewWidgetHtml(),
          // No network access: the page is fully inline.
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
        },
      ],
    })
  );
  return server;
}
