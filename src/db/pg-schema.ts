import {
  pgTable,
  text,
  timestamp,
  real,
  integer,
  boolean,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

// ── Users (synced from Clerk) ──

export const users = pgTable('users', {
  id: text('id').primaryKey(), // Clerk user ID
  email: text('email').notNull(),
  displayName: text('display_name'),
  tier: text('tier').notNull().default('free'), // 'free' | 'pro' | 'enterprise'
  apiKeyEncrypted: text('api_key_encrypted'), // BYOK: AES-256-GCM encrypted Anthropic key
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Conversations ──

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').default('New conversation'),
    channel: text('channel').default('web'), // 'web' | 'voice' | 'telegram' | etc.
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('conversations_user_idx').on(t.userId)],
);

// ── Messages ──

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    emotionShift: jsonb('emotion_shift'), // Partial<SelfState>
    metadata: jsonb('metadata'), // tool activities, etc.
    enriched: boolean('enriched').default(false), // whether background enrichment has processed this message
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId)],
);

// ── Cognitive States (per-user self state) ──

export const cognitiveStates = pgTable('cognitive_states', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  valence: real('valence').notNull().default(0.6),
  arousal: real('arousal').notNull().default(0.3),
  confidence: real('confidence').notNull().default(0.5),
  energy: real('energy').notNull().default(0.7),
  social: real('social').notNull().default(0.4),
  curiosity: real('curiosity').notNull().default(0.6),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Memories (with vector embeddings) ──

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull().default('episodic'), // 'episodic' | 'semantic' | 'procedural'
    content: text('content').notNull(),
    significance: real('significance').notNull().default(0.5),
    tags: text('tags').array(),
    embedding: vector('embedding', { dimensions: 384 }), // all-MiniLM-L6-v2 (local)
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('memories_user_idx').on(t.userId)],
);

// ── Scheduled Jobs ──

export const scheduledJobs = pgTable(
  'scheduled_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    cronExpr: text('cron_expr'),
    nextRunAt: timestamp('next_run_at').notNull(),
    timezone: text('timezone').default('UTC'),
    payload: text('payload'), // JSON string with job details
    status: text('status').notNull().default('active'), // 'active' | 'completed' | 'cancelled'
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('scheduled_jobs_user_idx').on(t.userId),
    index('scheduled_jobs_status_next_run_idx').on(t.status, t.nextRunAt),
  ],
);

// ── Usage Records ──

export const usageRecords = pgTable(
  'usage_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costCents: real('cost_cents').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('usage_user_idx').on(t.userId)],
);

// ── Agent Files (OpenClaw SOUL.md / IDENTITY.md / USER.md persisted for serverless) ──

export const agentFiles = pgTable(
  'agent_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: text('agent_id').notNull(),
    fileName: text('file_name').notNull(),
    content: text('content').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('agent_files_agent_file_idx').on(t.agentId, t.fileName)],
);

// ── Channel Conversations (persistent channel history) ──

export const channelConversations = pgTable(
  'channel_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    channelType: text('channel_type').notNull(), // 'telegram' | 'slack' | 'discord' | 'whatsapp' | ...
    channelUserId: text('channel_user_id').notNull(),
    messages: jsonb('messages').notNull(), // Array<{ role, content }>
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('channel_conversations_user_channel_idx').on(t.userId, t.channelType, t.channelUserId),
  ],
);
