/**
 * OpenClaw tool/skill definitions and report generation.
 *
 * Exposes openzca capabilities as structured tool definitions that OpenClaw
 * can discover and invoke programmatically.
 */

import { getDb, getDbStatus, listGroups, listFriends, listChats, listThreadMembers, listMessages, getThreadInfo, getSelfProfile, type DbMessageRow, type DbThreadType } from "./db.js";

// ---------------------------------------------------------------------------
// Tool manifest types
// ---------------------------------------------------------------------------

export type ToolParam = {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description: string;
};

export type ToolDef = {
  name: string;
  category: string;
  description: string;
  params: ToolParam[];
};

// ---------------------------------------------------------------------------
// Tool definitions (the manifest OpenClaw reads to know what openzca can do)
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS: ToolDef[] = [
  // --- Data reading tools ---
  {
    name: "group_list",
    category: "data",
    description: "List all Zalo groups with message counts, member counts, and activity timestamps",
    params: [],
  },
  {
    name: "group_info",
    category: "data",
    description: "Get detailed info about a specific group including members",
    params: [
      { name: "threadId", type: "string", required: true, description: "Group thread ID" },
    ],
  },
  {
    name: "group_members",
    category: "data",
    description: "List all members of a group with display names and roles",
    params: [
      { name: "threadId", type: "string", required: true, description: "Group thread ID" },
    ],
  },
  {
    name: "group_messages",
    category: "data",
    description: "Retrieve messages from a group with optional time range and count limit",
    params: [
      { name: "threadId", type: "string", required: true, description: "Group thread ID" },
      { name: "count", type: "number", required: false, description: "Max messages to return (default 50)" },
      { name: "sinceMs", type: "number", required: false, description: "Only messages after this Unix timestamp (ms)" },
      { name: "untilMs", type: "number", required: false, description: "Only messages before this Unix timestamp (ms)" },
    ],
  },
  {
    name: "chat_list",
    category: "data",
    description: "List all direct message conversations with activity timestamps",
    params: [],
  },
  {
    name: "chat_messages",
    category: "data",
    description: "Retrieve messages from a direct message conversation",
    params: [
      { name: "threadId", type: "string", required: true, description: "Chat thread ID" },
      { name: "count", type: "number", required: false, description: "Max messages to return (default 50)" },
      { name: "sinceMs", type: "number", required: false, description: "Only messages after this Unix timestamp (ms)" },
      { name: "untilMs", type: "number", required: false, description: "Only messages before this Unix timestamp (ms)" },
    ],
  },
  {
    name: "friend_list",
    category: "data",
    description: "List all friends with display names and message counts",
    params: [],
  },
  {
    name: "db_status",
    category: "data",
    description: "Get database status including total message, thread, group, and user counts",
    params: [],
  },
  {
    name: "self_profile",
    category: "data",
    description: "Get the stored profile info for the current account",
    params: [],
  },

  // --- Analysis / report tools ---
  {
    name: "report_summary",
    category: "analysis",
    description: "Generate an overall summary report: total groups, chats, messages, top active groups, top active users",
    params: [],
  },
  {
    name: "report_group",
    category: "analysis",
    description: "Generate an activity report for a specific group: message volume over time, top senders, message type breakdown, active hours",
    params: [
      { name: "threadId", type: "string", required: true, description: "Group thread ID" },
      { name: "sinceMs", type: "number", required: false, description: "Analyze only messages after this Unix timestamp (ms)" },
      { name: "untilMs", type: "number", required: false, description: "Analyze only messages before this Unix timestamp (ms)" },
    ],
  },
  {
    name: "report_activity",
    category: "analysis",
    description: "Generate a cross-group activity timeline: daily message counts, most active groups per day, trending topics",
    params: [
      { name: "days", type: "number", required: false, description: "Number of past days to analyze (default 7)" },
    ],
  },
  {
    name: "report_member",
    category: "analysis",
    description: "Generate a member participation report for a group: per-member message counts, reply rates, media usage",
    params: [
      { name: "threadId", type: "string", required: true, description: "Group thread ID" },
      { name: "sinceMs", type: "number", required: false, description: "Analyze only messages after this Unix timestamp (ms)" },
    ],
  },
  {
    name: "search_messages",
    category: "data",
    description: "Search messages across all threads by content text (case-insensitive substring match)",
    params: [
      { name: "query", type: "string", required: true, description: "Search query string" },
      { name: "threadId", type: "string", required: false, description: "Limit search to a specific thread" },
      { name: "threadType", type: "string", required: false, description: "Filter by thread type: 'group' or 'user'" },
      { name: "count", type: "number", required: false, description: "Max results to return (default 50)" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

export type ToolCallResult = {
  success: boolean;
  data?: unknown;
  error?: string;
};

export async function executeToolCall(
  profile: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    switch (toolName) {
      case "group_list":
        return { success: true, data: await listGroups(profile) };

      case "group_info":
        return { success: true, data: await getThreadInfo({ profile, threadId: String(params.threadId), threadType: "group" }) };

      case "group_members":
        return { success: true, data: await listThreadMembers({ profile, threadId: String(params.threadId) }) };

      case "group_messages":
        return { success: true, data: await listMessages({ profile, threadId: String(params.threadId), threadType: "group", limit: asNumber(params.count, 50), sinceMs: asOptionalNumber(params.sinceMs), untilMs: asOptionalNumber(params.untilMs) }) };

      case "chat_list":
        return { success: true, data: await listChats(profile) };

      case "chat_messages":
        return { success: true, data: await listMessages({ profile, threadId: String(params.threadId), threadType: "user", limit: asNumber(params.count, 50), sinceMs: asOptionalNumber(params.sinceMs), untilMs: asOptionalNumber(params.untilMs) }) };

      case "friend_list":
        return { success: true, data: await listFriends(profile) };

      case "db_status":
        return { success: true, data: await getDbStatus(profile) };

      case "self_profile":
        return { success: true, data: await getSelfProfile(profile) };

      case "report_summary":
        return { success: true, data: await generateSummaryReport(profile) };

      case "report_group":
        return { success: true, data: await generateGroupReport(profile, String(params.threadId), asOptionalNumber(params.sinceMs), asOptionalNumber(params.untilMs)) };

      case "report_activity":
        return { success: true, data: await generateActivityReport(profile, asNumber(params.days, 7)) };

      case "report_member":
        return { success: true, data: await generateMemberReport(profile, String(params.threadId), asOptionalNumber(params.sinceMs)) };

      case "search_messages":
        return { success: true, data: await searchMessages(profile, String(params.query), params.threadId ? String(params.threadId) : undefined, params.threadType ? String(params.threadType) as DbThreadType : undefined, asNumber(params.count, 50)) };

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Helper conversions
// ---------------------------------------------------------------------------

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asOptionalNumber(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = asNumber(v, NaN);
  return Number.isFinite(n) ? n : undefined;
}

function asOptionalString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v || undefined;
  return String(v) || undefined;
}

// ---------------------------------------------------------------------------
// Report generators
// ---------------------------------------------------------------------------

export type SummaryReport = {
  generatedAt: string;
  profile: string;
  dbStatus: {
    messageCount: number;
    threadCount: number;
    groupCount: number;
    userCount: number;
    lastMessageAt?: string;
  };
  topActiveGroups: Array<{ threadId: string; title?: string; messageCount: number; memberCount: number; lastMessageAt?: string }>;
  topActiveChats: Array<{ threadId: string; title?: string; messageCount: number; lastMessageAt?: string }>;
  recentMessageVolume: { date: string; count: number }[];
};

export async function generateSummaryReport(profile: string): Promise<SummaryReport> {
  const status = await getDbStatus(profile);
  const groups = await listGroups(profile);
  const chats = await listChats(profile);

  const topGroups = groups
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 10)
    .map((g) => ({
      threadId: g.threadId,
      title: g.title,
      messageCount: g.messageCount,
      memberCount: g.memberCount,
      lastMessageAt: g.lastMessageAtMs ? new Date(g.lastMessageAtMs).toISOString() : undefined,
    }));

  const topChats = chats
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 10)
    .map((c) => ({
      threadId: c.threadId,
      title: c.title,
      messageCount: c.messageCount,
      lastMessageAt: c.lastMessageAtMs ? new Date(c.lastMessageAtMs).toISOString() : undefined,
    }));

  const db = await getDb(profile);
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const volumeRows = await db.all<{ day: string; cnt: number }[]>(
    `SELECT date(timestamp_ms / 1000, 'unixepoch') AS day, COUNT(*) AS cnt
     FROM messages WHERE profile = ? AND timestamp_ms >= ?
     GROUP BY day ORDER BY day`,
    [profile, thirtyDaysAgo],
  );

  return {
    generatedAt: new Date().toISOString(),
    profile,
    dbStatus: {
      messageCount: status.messageCount,
      threadCount: status.threadCount,
      groupCount: status.groupCount,
      userCount: status.userCount,
      lastMessageAt: status.lastMessageAtMs ? new Date(status.lastMessageAtMs).toISOString() : undefined,
    },
    topActiveGroups: topGroups,
    topActiveChats: topChats,
    recentMessageVolume: volumeRows.map((r) => ({ date: r.day, count: r.cnt })),
  };
}

export type GroupReport = {
  generatedAt: string;
  threadId: string;
  title?: string;
  memberCount: number;
  totalMessages: number;
  timeRange: { from?: string; to?: string };
  topSenders: Array<{ senderId: string; senderName?: string; messageCount: number; percentage: number }>;
  messageTypeBreakdown: Array<{ msgType: string; count: number; percentage: number }>;
  activeHours: Array<{ hour: number; count: number }>;
  dailyVolume: Array<{ date: string; count: number }>;
};

export async function generateGroupReport(
  profile: string,
  threadId: string,
  sinceMs?: number,
  untilMs?: number,
): Promise<GroupReport> {
  const db = await getDb(profile);
  const info = await getThreadInfo({ profile, threadId, threadType: "group" });
  const members = await listThreadMembers({ profile, threadId });

  const timeFilters: string[] = ["profile = ?", "scope_thread_id = ?"];
  const timeParams: unknown[] = [profile, threadId];
  if (sinceMs !== undefined) {
    timeFilters.push("timestamp_ms >= ?");
    timeParams.push(sinceMs);
  }
  if (untilMs !== undefined) {
    timeFilters.push("timestamp_ms <= ?");
    timeParams.push(untilMs);
  }
  const where = timeFilters.join(" AND ");

  const totalRow = await db.get<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM messages WHERE ${where}`, timeParams);
  const totalMessages = totalRow?.cnt ?? 0;

  const senderRows = await db.all<{ sender_id: string; sender_name: string | null; cnt: number }[]>(
    `SELECT sender_id, sender_name, COUNT(*) AS cnt FROM messages WHERE ${where} AND sender_id IS NOT NULL GROUP BY sender_id ORDER BY cnt DESC LIMIT 20`,
    timeParams,
  );
  const topSenders = senderRows.map((r) => ({
    senderId: r.sender_id,
    senderName: r.sender_name ?? undefined,
    messageCount: r.cnt,
    percentage: totalMessages > 0 ? Math.round((r.cnt / totalMessages) * 10000) / 100 : 0,
  }));

  const typeRows = await db.all<{ msg_type: string; cnt: number }[]>(
    `SELECT COALESCE(msg_type, 'unknown') AS msg_type, COUNT(*) AS cnt FROM messages WHERE ${where} GROUP BY msg_type ORDER BY cnt DESC`,
    timeParams,
  );
  const messageTypeBreakdown = typeRows.map((r) => ({
    msgType: r.msg_type,
    count: r.cnt,
    percentage: totalMessages > 0 ? Math.round((r.cnt / totalMessages) * 10000) / 100 : 0,
  }));

  const hourRows = await db.all<{ hr: number; cnt: number }[]>(
    `SELECT CAST(strftime('%H', timestamp_ms / 1000, 'unixepoch') AS INTEGER) AS hr, COUNT(*) AS cnt FROM messages WHERE ${where} GROUP BY hr ORDER BY hr`,
    timeParams,
  );
  const activeHours = hourRows.map((r) => ({ hour: r.hr, count: r.cnt }));

  const dailyRows = await db.all<{ day: string; cnt: number }[]>(
    `SELECT date(timestamp_ms / 1000, 'unixepoch') AS day, COUNT(*) AS cnt FROM messages WHERE ${where} GROUP BY day ORDER BY day`,
    timeParams,
  );

  return {
    generatedAt: new Date().toISOString(),
    threadId,
    title: asOptionalString(info?.title),
    memberCount: members.length,
    totalMessages,
    timeRange: {
      from: sinceMs ? new Date(sinceMs).toISOString() : undefined,
      to: untilMs ? new Date(untilMs).toISOString() : undefined,
    },
    topSenders,
    messageTypeBreakdown,
    activeHours,
    dailyVolume: dailyRows.map((r) => ({ date: r.day, count: r.cnt })),
  };
}

export type ActivityReport = {
  generatedAt: string;
  period: { from: string; to: string; days: number };
  totalMessages: number;
  dailyBreakdown: Array<{
    date: string;
    totalMessages: number;
    topGroups: Array<{ threadId: string; title?: string; count: number }>;
    topSenders: Array<{ senderId: string; senderName?: string; count: number }>;
  }>;
  overallTopGroups: Array<{ threadId: string; title?: string; count: number }>;
};

export async function generateActivityReport(profile: string, days: number): Promise<ActivityReport> {
  const db = await getDb(profile);
  const now = Date.now();
  const sinceMs = now - days * 24 * 60 * 60 * 1000;

  const dailyRows = await db.all<{ day: string; cnt: number }[]>(
    `SELECT date(timestamp_ms / 1000, 'unixepoch') AS day, COUNT(*) AS cnt
     FROM messages WHERE profile = ? AND timestamp_ms >= ?
     GROUP BY day ORDER BY day`,
    [profile, sinceMs],
  );

  const dailyBreakdown: ActivityReport["dailyBreakdown"] = [];
  for (const dayRow of dailyRows) {
    const dayStart = new Date(dayRow.day + "T00:00:00Z").getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const topGroupRows = await db.all<{ scope_thread_id: string; cnt: number }[]>(
      `SELECT scope_thread_id, COUNT(*) AS cnt FROM messages
       WHERE profile = ? AND timestamp_ms >= ? AND timestamp_ms < ?
       AND scope_thread_id IN (SELECT scope_thread_id FROM threads WHERE profile = ? AND thread_type = 'group')
       GROUP BY scope_thread_id ORDER BY cnt DESC LIMIT 5`,
      [profile, dayStart, dayEnd, profile],
    );

    const topSenderRows = await db.all<{ sender_id: string; sender_name: string | null; cnt: number }[]>(
      `SELECT sender_id, sender_name, COUNT(*) AS cnt FROM messages
       WHERE profile = ? AND timestamp_ms >= ? AND timestamp_ms < ? AND sender_id IS NOT NULL
       GROUP BY sender_id ORDER BY cnt DESC LIMIT 5`,
      [profile, dayStart, dayEnd],
    );

    const topGroups: Array<{ threadId: string; title?: string; count: number }> = [];
    for (const g of topGroupRows) {
      const gInfo = await getThreadInfo({ profile, threadId: g.scope_thread_id, threadType: "group" });
      topGroups.push({ threadId: g.scope_thread_id, title: asOptionalString(gInfo?.title), count: g.cnt });
    }

    dailyBreakdown.push({
      date: dayRow.day,
      totalMessages: dayRow.cnt,
      topGroups,
      topSenders: topSenderRows.map((s) => ({ senderId: s.sender_id, senderName: s.sender_name ?? undefined, count: s.cnt })),
    });
  }

  const overallGroupRows = await db.all<{ scope_thread_id: string; cnt: number }[]>(
    `SELECT scope_thread_id, COUNT(*) AS cnt FROM messages
     WHERE profile = ? AND timestamp_ms >= ?
     AND scope_thread_id IN (SELECT scope_thread_id FROM threads WHERE profile = ? AND thread_type = 'group')
     GROUP BY scope_thread_id ORDER BY cnt DESC LIMIT 10`,
    [profile, sinceMs, profile],
  );
  const overallTopGroups: Array<{ threadId: string; title?: string; count: number }> = [];
  for (const g of overallGroupRows) {
    const gInfo = await getThreadInfo({ profile, threadId: g.scope_thread_id, threadType: "group" });
    overallTopGroups.push({ threadId: g.scope_thread_id, title: asOptionalString(gInfo?.title), count: g.cnt });
  }

  return {
    generatedAt: new Date().toISOString(),
    period: {
      from: new Date(sinceMs).toISOString(),
      to: new Date(now).toISOString(),
      days,
    },
    totalMessages: dailyRows.reduce((sum, r) => sum + r.cnt, 0),
    dailyBreakdown,
    overallTopGroups,
  };
}

export type MemberReport = {
  generatedAt: string;
  threadId: string;
  title?: string;
  totalMessages: number;
  totalMembers: number;
  activeMembers: number;
  silentMembers: number;
  memberStats: Array<{
    userId: string;
    displayName?: string;
    messageCount: number;
    percentage: number;
    repliesGiven: number;
    mediaMessages: number;
    firstMessageAt?: string;
    lastMessageAt?: string;
  }>;
};

export async function generateMemberReport(
  profile: string,
  threadId: string,
  sinceMs?: number,
): Promise<MemberReport> {
  const db = await getDb(profile);
  const info = await getThreadInfo({ profile, threadId, threadType: "group" });
  const members = await listThreadMembers({ profile, threadId });

  const timeFilter = sinceMs !== undefined ? "AND timestamp_ms >= ?" : "";
  const timeParams = sinceMs !== undefined ? [sinceMs] : [];

  const memberRows = await db.all<{
    sender_id: string;
    sender_name: string | null;
    cnt: number;
    reply_cnt: number;
    media_cnt: number;
    first_ts: number | null;
    last_ts: number | null;
  }[]>(
    `SELECT
       sender_id,
       sender_name,
       COUNT(*) AS cnt,
       SUM(CASE WHEN quote_msg_id IS NOT NULL THEN 1 ELSE 0 END) AS reply_cnt,
       SUM(CASE WHEN media_json IS NOT NULL AND media_json != '[]' THEN 1 ELSE 0 END) AS media_cnt,
       MIN(timestamp_ms) AS first_ts,
       MAX(timestamp_ms) AS last_ts
     FROM messages
     WHERE profile = ? AND scope_thread_id = ? AND sender_id IS NOT NULL ${timeFilter}
     GROUP BY sender_id
     ORDER BY cnt DESC`,
    [profile, threadId, ...timeParams],
  );

  const totalMessages = memberRows.reduce((s, r) => s + r.cnt, 0);
  const activeSenderIds = new Set(memberRows.map((r) => r.sender_id));

  const memberStats = memberRows.map((r) => {
    const member = members.find((m) => (m as Record<string, unknown>).userId === r.sender_id) as Record<string, unknown> | undefined;
    return {
      userId: r.sender_id,
      displayName: r.sender_name ?? asOptionalString(member?.displayName),
      messageCount: r.cnt,
      percentage: totalMessages > 0 ? Math.round((r.cnt / totalMessages) * 10000) / 100 : 0,
      repliesGiven: r.reply_cnt,
      mediaMessages: r.media_cnt,
      firstMessageAt: r.first_ts ? new Date(r.first_ts).toISOString() : undefined,
      lastMessageAt: r.last_ts ? new Date(r.last_ts).toISOString() : undefined,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    threadId,
    title: asOptionalString(info?.title),
    totalMessages,
    totalMembers: members.length,
    activeMembers: activeSenderIds.size,
    silentMembers: members.length - activeSenderIds.size,
    memberStats,
  };
}

// ---------------------------------------------------------------------------
// Message search
// ---------------------------------------------------------------------------

export async function searchMessages(
  profile: string,
  query: string,
  threadId?: string,
  threadType?: DbThreadType,
  count: number = 50,
): Promise<DbMessageRow[]> {
  const db = await getDb(profile);
  const filters: string[] = ["profile = ?"];
  const params: unknown[] = [profile];

  if (threadId) {
    filters.push("scope_thread_id = ?");
    params.push(threadId);
  }
  if (threadType) {
    filters.push("thread_type = ?");
    params.push(threadType);
  }

  filters.push("content_text LIKE ?");
  params.push(`%${query}%`);
  params.push(count);

  const where = filters.join(" AND ");
  const rows = await db.all<Array<{
    scope_thread_id: string;
    raw_thread_id: string;
    thread_type: DbThreadType;
    msg_id: string;
    cli_msg_id: string;
    sender_id: string;
    sender_name: string | null;
    timestamp_ms: number;
    msg_type: string;
    content_text: string | null;
    to_id: string | null;
    quote_msg_id: string | null;
    quote_cli_msg_id: string | null;
    quote_owner_id: string | null;
    quote_text: string | null;
    source: string;
  }>>(
    `SELECT scope_thread_id, raw_thread_id, thread_type, msg_id, cli_msg_id,
            sender_id, sender_name, timestamp_ms, msg_type, content_text,
            to_id, quote_msg_id, quote_cli_msg_id, quote_owner_id, quote_text, source
     FROM messages
     WHERE ${where}
     ORDER BY timestamp_ms DESC
     LIMIT ?`,
    params,
  );

  return rows.map((r) => ({
    msgId: r.msg_id,
    cliMsgId: r.cli_msg_id,
    threadId: r.scope_thread_id,
    threadType: r.thread_type,
    senderId: r.sender_id,
    senderName: r.sender_name ?? "",
    ts: new Date(r.timestamp_ms).toISOString(),
    msgType: r.msg_type,
    undo: { msgId: r.msg_id, cliMsgId: r.cli_msg_id, threadId: r.scope_thread_id, group: r.thread_type === "group" },
    content: r.content_text ?? "",
    timestampMs: r.timestamp_ms,
    rawThreadId: r.raw_thread_id,
    toId: r.to_id ?? undefined,
    quoteMsgId: r.quote_msg_id ?? undefined,
    quoteCliMsgId: r.quote_cli_msg_id ?? undefined,
    quoteOwnerId: r.quote_owner_id ?? undefined,
    quoteText: r.quote_text ?? undefined,
    source: r.source,
  }));
}
