/**
 * Gmail email validation and filtering rules.
 *
 * Determines whether an incoming email matches a route's filter criteria
 * and formats the email content for Zalo delivery.
 */

import type { GmailFilter, GmailRoute, ParsedEmail } from "./gmail.js";

// ---------------------------------------------------------------------------
// Filter matching
// ---------------------------------------------------------------------------

export function matchesFilter(email: ParsedEmail, filter: GmailFilter): boolean {
  // Age check: reject emails older than maxAgeMins
  if (filter.maxAgeMins !== undefined) {
    const ageMs = Date.now() - email.dateMs;
    if (ageMs > filter.maxAgeMins * 60 * 1000) return false;
  }

  // From filter: at least one pattern must match (case-insensitive substring/glob)
  if (filter.from && filter.from.length > 0) {
    const emailFrom = email.from.toLowerCase();
    const emailFromName = email.fromName.toLowerCase();
    const matched = filter.from.some((pattern) => {
      const p = pattern.toLowerCase();
      return emailFrom.includes(p) || emailFromName.includes(p);
    });
    if (!matched) return false;
  }

  // Exclude from
  if (filter.excludeFrom && filter.excludeFrom.length > 0) {
    const emailFrom = email.from.toLowerCase();
    const emailFromName = email.fromName.toLowerCase();
    const excluded = filter.excludeFrom.some((pattern) => {
      const p = pattern.toLowerCase();
      return emailFrom.includes(p) || emailFromName.includes(p);
    });
    if (excluded) return false;
  }

  // Subject filter: at least one pattern must match
  if (filter.subject && filter.subject.length > 0) {
    const emailSubject = email.subject.toLowerCase();
    const matched = filter.subject.some((pattern) =>
      emailSubject.includes(pattern.toLowerCase()),
    );
    if (!matched) return false;
  }

  // Exclude subject
  if (filter.excludeSubject && filter.excludeSubject.length > 0) {
    const emailSubject = email.subject.toLowerCase();
    const excluded = filter.excludeSubject.some((pattern) =>
      emailSubject.includes(pattern.toLowerCase()),
    );
    if (excluded) return false;
  }

  // Label filter: email must have at least one of the specified labels
  if (filter.labels && filter.labels.length > 0) {
    const emailLabels = new Set(email.labels.map((l) => l.toLowerCase()));
    const matched = filter.labels.some((label) => emailLabels.has(label.toLowerCase()));
    if (!matched) return false;
  }

  // Attachment filter
  if (filter.hasAttachment !== undefined) {
    if (filter.hasAttachment !== email.hasAttachment) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Email validation
// ---------------------------------------------------------------------------

export type ValidationResult = {
  valid: boolean;
  reasons: string[];
};

export function validateEmail(email: ParsedEmail): ValidationResult {
  const reasons: string[] = [];

  // Must have a sender
  if (!email.from) {
    reasons.push("Missing sender address");
  }

  // Must have a subject or body
  if (!email.subject && !email.bodyText && !email.snippet) {
    reasons.push("Empty email: no subject, body, or snippet");
  }

  // Reject auto-generated / no-reply
  const autoHeaders = ["noreply", "no-reply", "mailer-daemon", "postmaster"];
  if (autoHeaders.some((h) => email.from.toLowerCase().includes(h))) {
    reasons.push(`Auto-generated sender: ${email.from}`);
  }

  // Reject very old emails (>24h by default)
  const ageMs = Date.now() - email.dateMs;
  if (ageMs > 24 * 60 * 60 * 1000) {
    reasons.push(`Email too old: ${Math.round(ageMs / 3600000)}h ago`);
  }

  // Reject suspiciously large body (>10KB text) — truncation will happen at format time
  // but flag it so we know
  if (email.bodyText.length > 50000) {
    reasons.push(`Very large body: ${email.bodyText.length} chars`);
  }

  return { valid: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Route matching — find all routes that match an email
// ---------------------------------------------------------------------------

export function findMatchingRoutes(email: ParsedEmail, routes: GmailRoute[]): GmailRoute[] {
  return routes.filter((route) => route.enabled && matchesFilter(email, route.filters));
}

// ---------------------------------------------------------------------------
// Format email as Zalo message
// ---------------------------------------------------------------------------

const MAX_ZALO_MSG_LENGTH = 2000;

export function formatEmailForZalo(email: ParsedEmail, route: GmailRoute): string {
  if (route.formatTemplate) {
    return applyTemplate(route.formatTemplate, email);
  }

  // Default format
  const lines: string[] = [];
  lines.push(`📧 **${escapeMarkdown(email.subject || "(no subject)")}**`);
  lines.push(`> From: ${email.fromName || email.from}`);
  lines.push(`> ${formatRelativeTime(email.dateMs)}`);
  lines.push("");

  // Use snippet for concise summary, body for full content
  const body = email.bodyText.trim() || email.snippet;
  if (body) {
    lines.push(truncateText(body, MAX_ZALO_MSG_LENGTH - lines.join("\n").length - 100));
  }

  if (email.attachments.length > 0) {
    lines.push("");
    lines.push(`📎 ${email.attachments.length} attachment(s): ${email.attachments.map((a) => a.filename).join(", ")}`);
  }

  const result = lines.join("\n");
  return result.length > MAX_ZALO_MSG_LENGTH
    ? result.slice(0, MAX_ZALO_MSG_LENGTH - 3) + "..."
    : result;
}

function applyTemplate(template: string, email: ParsedEmail): string {
  const body = email.bodyText.trim() || email.snippet;
  const result = template
    .replace(/\{from\}/g, email.from)
    .replace(/\{fromName\}/g, email.fromName)
    .replace(/\{subject\}/g, email.subject)
    .replace(/\{snippet\}/g, email.snippet)
    .replace(/\{body\}/g, truncateText(body, 1500))
    .replace(/\{date\}/g, email.date)
    .replace(/\{relativeTime\}/g, formatRelativeTime(email.dateMs))
    .replace(/\{attachmentCount\}/g, String(email.attachments.length))
    .replace(/\{attachmentNames\}/g, email.attachments.map((a) => a.filename).join(", "));

  return result.length > MAX_ZALO_MSG_LENGTH
    ? result.slice(0, MAX_ZALO_MSG_LENGTH - 3) + "..."
    : result;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([*_~])/g, "\\$1");
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)}h ago`;
  return `${Math.round(diff / 86400_000)}d ago`;
}

// ---------------------------------------------------------------------------
// Route ID generation
// ---------------------------------------------------------------------------

let routeCounter = 0;
export function generateRouteId(): string {
  routeCounter++;
  return `route_${Date.now().toString(36)}_${routeCounter}`;
}
