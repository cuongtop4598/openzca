/**
 * Gmail API client — OAuth2 token management, inbox polling, email parsing.
 *
 * Uses Gmail REST API with fetch (Node 18+), no external dependencies.
 * Stores OAuth credentials and state in the profile directory.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getProfileDir } from "./store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

export type GmailPollState = {
  lastPollAtMs: number;
  lastHistoryId?: string;
  processedMessageIds: string[];
};

export type GmailRoute = {
  id: string;
  name: string;
  filters: GmailFilter;
  target: {
    threadId: string;
    isGroup: boolean;
  };
  enabled: boolean;
  createdAt: string;
  formatTemplate?: string;
};

export type GmailFilter = {
  from?: string[];
  subject?: string[];
  labels?: string[];
  hasAttachment?: boolean;
  excludeFrom?: string[];
  excludeSubject?: string[];
  maxAgeMins?: number;
};

export type GmailConfig = {
  oauth: GmailOAuthConfig;
  routes: GmailRoute[];
  pollIntervalMs: number;
  maxEmailsPerPoll: number;
  updatedAt: string;
};

export type ParsedEmail = {
  messageId: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string;
  date: string;
  dateMs: number;
  labels: string[];
  hasAttachment: boolean;
  attachments: Array<{ filename: string; mimeType: string; size: number }>;
};

export type GmailForwardResult = {
  email: ParsedEmail;
  route: GmailRoute;
  sent: boolean;
  error?: string;
  sentAt?: string;
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const GMAIL_CONFIG_FILE = "gmail-config.json";
const GMAIL_STATE_FILE = "gmail-poll-state.json";

export function getGmailConfigPath(profile: string): string {
  return path.join(getProfileDir(profile), GMAIL_CONFIG_FILE);
}

function getGmailStatePath(profile: string): string {
  return path.join(getProfileDir(profile), GMAIL_STATE_FILE);
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

export async function readGmailConfig(profile: string): Promise<GmailConfig | null> {
  try {
    const raw = await fs.readFile(getGmailConfigPath(profile), "utf8");
    return JSON.parse(raw) as GmailConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeGmailConfig(profile: string, config: GmailConfig): Promise<void> {
  const configPath = getGmailConfigPath(profile);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function readGmailPollState(profile: string): Promise<GmailPollState> {
  try {
    const raw = await fs.readFile(getGmailStatePath(profile), "utf8");
    return JSON.parse(raw) as GmailPollState;
  } catch {
    return { lastPollAtMs: 0, processedMessageIds: [] };
  }
}

export async function writeGmailPollState(profile: string, state: GmailPollState): Promise<void> {
  const statePath = getGmailStatePath(profile);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  // Keep only last 500 processed IDs to prevent unbounded growth
  state.processedMessageIds = state.processedMessageIds.slice(-500);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// OAuth2 token management
// ---------------------------------------------------------------------------

const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function refreshAccessToken(oauth: GmailOAuthConfig): Promise<GmailOAuthConfig> {
  if (oauth.accessToken && oauth.accessTokenExpiresAt && Date.now() < oauth.accessTokenExpiresAt - 60_000) {
    return oauth;
  }

  const response = await fetch(GMAIL_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: oauth.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail OAuth token refresh failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return {
    ...oauth,
    accessToken: data.access_token,
    accessTokenExpiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ---------------------------------------------------------------------------
// Gmail API calls
// ---------------------------------------------------------------------------

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailGet(token: string, endpoint: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${GMAIL_API}/${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const response = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail API error (${response.status}): ${text}`);
  }
  return response.json();
}

type GmailMessageListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailMessageResponse = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    mimeType: string;
    body?: { data?: string; size?: number };
    parts?: Array<{
      mimeType: string;
      filename?: string;
      body?: { data?: string; size?: number; attachmentId?: string };
      parts?: Array<{
        mimeType: string;
        body?: { data?: string; size?: number };
      }>;
    }>;
  };
};

export async function listNewMessages(
  token: string,
  maxResults: number = 10,
  query?: string,
): Promise<Array<{ id: string; threadId: string }>> {
  const params: Record<string, string> = {
    maxResults: String(maxResults),
    labelIds: "INBOX",
  };
  if (query) params.q = query;

  const data = (await gmailGet(token, "messages", params)) as GmailMessageListResponse;
  return data.messages ?? [];
}

export async function getMessage(token: string, messageId: string): Promise<ParsedEmail> {
  const raw = (await gmailGet(token, `messages/${messageId}`, { format: "full" })) as GmailMessageResponse;
  return parseGmailMessage(raw);
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractBody(payload: GmailMessageResponse["payload"]): { text: string; html: string } {
  let text = "";
  let html = "";

  if (payload.body?.data) {
    if (payload.mimeType === "text/plain") text = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/html") html = decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        text = decodeBase64Url(part.body.data);
      }
      if (part.mimeType === "text/html" && part.body?.data) {
        html = decodeBase64Url(part.body.data);
      }
      if (part.mimeType === "multipart/alternative" && part.parts) {
        for (const sub of part.parts) {
          if (sub.mimeType === "text/plain" && sub.body?.data) {
            text = decodeBase64Url(sub.body.data);
          }
          if (sub.mimeType === "text/html" && sub.body?.data) {
            html = decodeBase64Url(sub.body.data);
          }
        }
      }
    }
  }

  return { text, html };
}

function extractAttachments(payload: GmailMessageResponse["payload"]): Array<{ filename: string; mimeType: string; size: number }> {
  const attachments: Array<{ filename: string; mimeType: string; size: number }> = [];
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size ?? 0,
        });
      }
    }
  }
  return attachments;
}

function parseFromHeader(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].replace(/^"|"$/g, "").trim(), email: match[2] };
  return { name: from, email: from };
}

function parseGmailMessage(raw: GmailMessageResponse): ParsedEmail {
  const headers = raw.payload.headers;
  const from = getHeader(headers, "From");
  const parsed = parseFromHeader(from);
  const body = extractBody(raw.payload);
  const attachments = extractAttachments(raw.payload);
  const dateMs = Number(raw.internalDate);

  return {
    messageId: raw.id,
    threadId: raw.threadId,
    from: parsed.email,
    fromName: parsed.name,
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    snippet: raw.snippet,
    bodyText: body.text,
    bodyHtml: body.html,
    date: new Date(dateMs).toISOString(),
    dateMs,
    labels: raw.labelIds ?? [],
    hasAttachment: attachments.length > 0,
    attachments,
  };
}

// ---------------------------------------------------------------------------
// Mark message as read (optional)
// ---------------------------------------------------------------------------

export async function markAsRead(token: string, messageId: string): Promise<void> {
  const url = `${GMAIL_API}/messages/${messageId}/modify`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail markAsRead failed (${response.status}): ${text}`);
  }
}
