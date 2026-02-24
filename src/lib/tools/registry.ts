import type { ToolDefinition as ProviderToolDefinition } from '@/lib/llm/provider';
import { discoverOpenClawTools, openClawToolsAsDefinitions } from '@/lib/openclaw-tool-bridge';

export type ToolDefinition = ProviderToolDefinition;

/**
 * Get the full tool registry: core Wybe tools + discovered OpenClaw tools.
 * OpenClaw tools are prefixed with `openclaw_` to avoid name collisions.
 */
export async function getFullToolRegistry(): Promise<ToolDefinition[]> {
  const openClawTools = await discoverOpenClawTools().catch(() => []);
  return [...tools, ...openClawToolsAsDefinitions(openClawTools)];
}

export const tools: ToolDefinition[] = [
  {
    name: 'web_search',
    description:
      'Search the web for current information. Returns titles, URLs, and snippets. Supports multiple providers: Brave (default), Perplexity, and Grok.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The search query string.',
        },
        count: {
          type: 'number',
          description: 'Number of results to return (1-10). Default: 5.',
        },
        provider: {
          type: 'string',
          enum: ['brave', 'perplexity', 'grok'],
          description: 'Search provider. Default: auto-selects based on available API keys.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description:
      'Fetch and extract readable content from a URL. Converts HTML to clean text using Readability, with Firecrawl fallback for JS-heavy pages.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The HTTP or HTTPS URL to fetch.',
        },
        max_chars: {
          type: 'number',
          description: 'Maximum characters to return. Default: 20000.',
        },
        use_firecrawl: {
          type: 'boolean',
          description: 'Force Firecrawl for better extraction on JS-heavy pages. Default: false.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'memory_search',
    description:
      'Search your memories about this person and past conversations. Use when the user references something from the past or when you want to recall relevant context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in memories.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'text_to_speech',
    description:
      'Convert text to spoken audio. Returns base64 audio. Providers: edge (free, default), elevenlabs, openai.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'The text to speak.',
        },
        voice: {
          type: 'string',
          description: 'Voice name or ID. For edge: default/male/female/british/australian. For openai: alloy/echo/fable/onyx/nova/shimmer.',
        },
        provider: {
          type: 'string',
          enum: ['edge', 'elevenlabs', 'openai'],
          description: 'TTS provider. Default: edge (free, no API key needed).',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'generate_image',
    description:
      'Generate an image from a text description using DALL-E 3. Returns an image URL.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'A detailed description of the image to generate.',
        },
        size: {
          type: 'string',
          enum: ['1024x1024', '1024x1792', '1792x1024'],
          description: 'Image dimensions. Default: 1024x1024.',
        },
        quality: {
          type: 'string',
          enum: ['standard', 'hd'],
          description: 'Image quality. Default: standard.',
        },
        style: {
          type: 'string',
          enum: ['vivid', 'natural'],
          description: 'Image style. Default: vivid.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'understand_image',
    description:
      'Analyze and describe an image using Claude Vision. Can answer questions about images. Accepts image URLs or base64 data URIs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The image URL or base64 data URI.',
        },
        question: {
          type: 'string',
          description: 'Optional specific question about the image. If omitted, provides a general description.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'transcribe_audio',
    description:
      'Transcribe audio to text using Whisper or Deepgram. Accepts audio URLs or base64 data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'URL of the audio file, or base64-encoded audio data.',
        },
        language: {
          type: 'string',
          description: 'Language code (e.g. "en"). Auto-detected if not provided.',
        },
        provider: {
          type: 'string',
          enum: ['openai', 'deepgram'],
          description: 'Transcription provider. Default: openai.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'read_pdf',
    description:
      'Extract text content from a PDF file. Accepts a URL to a PDF document.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'URL of the PDF file.',
        },
        max_pages: {
          type: 'number',
          description: 'Maximum number of pages to extract. Default: 50.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'schedule_task',
    description:
      'Schedule a task to run at a future time or on a recurring schedule. Use for reminders, recurring checks, or timed actions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string',
          description: 'What to do when the schedule fires. This will be sent as a message prompt.',
        },
        run_at: {
          type: 'string',
          description: 'ISO 8601 datetime for one-time tasks (e.g. "2025-03-15T14:30:00Z").',
        },
        cron: {
          type: 'string',
          description: 'Cron expression for recurring tasks (e.g. "0 9 * * 1" for every Monday at 9am).',
        },
        timezone: {
          type: 'string',
          description: 'Timezone for the schedule. Default: UTC.',
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'list_schedules',
    description:
      'List all scheduled tasks for the current user.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'cancel_schedule',
    description:
      'Cancel a scheduled task by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        schedule_id: {
          type: 'string',
          description: 'The ID of the schedule to cancel.',
        },
      },
      required: ['schedule_id'],
    },
  },
  {
    name: 'send_message',
    description:
      'Send a message to a user on any connected channel (Telegram, Slack, Discord, WhatsApp).',
    input_schema: {
      type: 'object' as const,
      properties: {
        channel: {
          type: 'string',
          enum: ['telegram', 'slack', 'discord', 'whatsapp'],
          description: 'The channel to send the message on.',
        },
        recipient: {
          type: 'string',
          description: 'The recipient ID (chat ID for Telegram, channel ID for Slack, etc.).',
        },
        text: {
          type: 'string',
          description: 'The message text to send.',
        },
      },
      required: ['channel', 'recipient', 'text'],
    },
  },
  {
    name: 'browser_navigate',
    description:
      'Navigate to a URL and return the page content as accessible snapshot text. Use for browsing the web visually.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_screenshot',
    description:
      'Take a screenshot of the current page in the browser session. Returns a base64-encoded image.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'browser_act',
    description:
      'Perform an action on the current page: click, type, scroll, or interact with elements.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['click', 'type', 'scroll', 'select', 'hover'],
          description: 'The action to perform.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector or text content of the element to act on.',
        },
        value: {
          type: 'string',
          description: 'Value to type (for "type" action) or scroll direction (for "scroll": "up"/"down").',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'execute_code',
    description:
      'Execute code in a sandboxed environment. Supports JavaScript, TypeScript, Python, and Bash.',
    input_schema: {
      type: 'object' as const,
      properties: {
        code: {
          type: 'string',
          description: 'The code to execute.',
        },
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'python', 'bash'],
          description: 'Programming language. Default: javascript.',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'send_email',
    description:
      'Send an email. Requires Gmail API or SMTP credentials to be configured.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address.',
        },
        subject: {
          type: 'string',
          description: 'Email subject line.',
        },
        body: {
          type: 'string',
          description: 'Email body (plain text or HTML).',
        },
        html: {
          type: 'boolean',
          description: 'Whether the body is HTML. Default: false.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'get_weather',
    description:
      'Get current weather and forecast for a location.',
    input_schema: {
      type: 'object' as const,
      properties: {
        location: {
          type: 'string',
          description: 'City name, address, or coordinates (lat,lon).',
        },
      },
      required: ['location'],
    },
  },
];
