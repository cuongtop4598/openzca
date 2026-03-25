import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchesFilter,
  validateEmail,
  findMatchingRoutes,
  formatEmailForZalo,
  generateRouteId,
} from "../src/lib/gmail-filter.js";
import type { ParsedEmail, GmailRoute, GmailFilter } from "../src/lib/gmail.js";

function makeEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    messageId: "msg_1",
    threadId: "thread_1",
    from: "alice@example.com",
    fromName: "Alice Smith",
    to: "me@example.com",
    subject: "Weekly Report Q1",
    snippet: "Here is the weekly report for Q1...",
    bodyText: "Hello, here is the weekly report for Q1. Please review.",
    bodyHtml: "<p>Hello, here is the weekly report for Q1.</p>",
    date: new Date().toISOString(),
    dateMs: Date.now() - 60_000, // 1 minute ago
    labels: ["INBOX", "UNREAD"],
    hasAttachment: false,
    attachments: [],
    ...overrides,
  };
}

function makeRoute(overrides: Partial<GmailRoute> = {}): GmailRoute {
  return {
    id: "route_1",
    name: "Test Route",
    filters: {},
    target: { threadId: "zalo_group_123", isGroup: true },
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("matchesFilter", () => {
  it("should match when filter is empty (catch-all)", () => {
    assert.ok(matchesFilter(makeEmail(), {}));
  });

  it("should match from filter (case-insensitive substring)", () => {
    assert.ok(matchesFilter(makeEmail(), { from: ["alice"] }));
    assert.ok(matchesFilter(makeEmail(), { from: ["ALICE"] }));
    assert.ok(matchesFilter(makeEmail(), { from: ["example.com"] }));
    assert.ok(!matchesFilter(makeEmail(), { from: ["bob"] }));
  });

  it("should match subject filter", () => {
    assert.ok(matchesFilter(makeEmail(), { subject: ["weekly"] }));
    assert.ok(matchesFilter(makeEmail(), { subject: ["Report"] }));
    assert.ok(!matchesFilter(makeEmail(), { subject: ["monthly"] }));
  });

  it("should exclude by from", () => {
    assert.ok(!matchesFilter(makeEmail(), { excludeFrom: ["alice"] }));
    assert.ok(matchesFilter(makeEmail(), { excludeFrom: ["bob"] }));
  });

  it("should exclude by subject", () => {
    assert.ok(!matchesFilter(makeEmail(), { excludeSubject: ["weekly"] }));
    assert.ok(matchesFilter(makeEmail(), { excludeSubject: ["monthly"] }));
  });

  it("should filter by attachment presence", () => {
    assert.ok(!matchesFilter(makeEmail({ hasAttachment: false }), { hasAttachment: true }));
    assert.ok(matchesFilter(makeEmail({ hasAttachment: true }), { hasAttachment: true }));
  });

  it("should filter by max age", () => {
    assert.ok(matchesFilter(makeEmail({ dateMs: Date.now() - 60_000 }), { maxAgeMins: 5 }));
    assert.ok(!matchesFilter(makeEmail({ dateMs: Date.now() - 600_000 }), { maxAgeMins: 5 }));
  });

  it("should filter by labels", () => {
    assert.ok(matchesFilter(makeEmail({ labels: ["INBOX", "IMPORTANT"] }), { labels: ["IMPORTANT"] }));
    assert.ok(!matchesFilter(makeEmail({ labels: ["INBOX"] }), { labels: ["IMPORTANT"] }));
  });

  it("should combine multiple filters with AND logic", () => {
    const email = makeEmail({ from: "alice@example.com", subject: "Weekly Report" });
    assert.ok(matchesFilter(email, { from: ["alice"], subject: ["weekly"] }));
    assert.ok(!matchesFilter(email, { from: ["bob"], subject: ["weekly"] }));
    assert.ok(!matchesFilter(email, { from: ["alice"], subject: ["monthly"] }));
  });
});

describe("validateEmail", () => {
  it("should pass valid emails", () => {
    const result = validateEmail(makeEmail());
    assert.ok(result.valid);
    assert.equal(result.reasons.length, 0);
  });

  it("should reject emails without sender", () => {
    const result = validateEmail(makeEmail({ from: "" }));
    assert.ok(!result.valid);
  });

  it("should reject no-reply senders", () => {
    const result = validateEmail(makeEmail({ from: "noreply@example.com" }));
    assert.ok(!result.valid);
    assert.ok(result.reasons.some((r) => r.includes("Auto-generated")));
  });

  it("should reject old emails (>24h)", () => {
    const result = validateEmail(makeEmail({ dateMs: Date.now() - 25 * 60 * 60 * 1000 }));
    assert.ok(!result.valid);
    assert.ok(result.reasons.some((r) => r.includes("too old")));
  });

  it("should reject empty emails", () => {
    const result = validateEmail(makeEmail({ subject: "", bodyText: "", snippet: "" }));
    assert.ok(!result.valid);
  });
});

describe("findMatchingRoutes", () => {
  it("should return matching routes", () => {
    const routes = [
      makeRoute({ id: "r1", filters: { from: ["alice"] } }),
      makeRoute({ id: "r2", filters: { from: ["bob"] } }),
    ];
    const matches = findMatchingRoutes(makeEmail(), routes);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, "r1");
  });

  it("should skip disabled routes", () => {
    const routes = [
      makeRoute({ id: "r1", filters: { from: ["alice"] }, enabled: false }),
    ];
    const matches = findMatchingRoutes(makeEmail(), routes);
    assert.equal(matches.length, 0);
  });

  it("should return multiple matching routes", () => {
    const routes = [
      makeRoute({ id: "r1", filters: {} }), // catch-all
      makeRoute({ id: "r2", filters: { from: ["alice"] } }),
    ];
    const matches = findMatchingRoutes(makeEmail(), routes);
    assert.equal(matches.length, 2);
  });
});

describe("formatEmailForZalo", () => {
  it("should format email with default template", () => {
    const email = makeEmail();
    const route = makeRoute();
    const result = formatEmailForZalo(email, route);
    assert.ok(result.includes(email.subject));
    assert.ok(result.includes(email.fromName));
    assert.ok(result.length <= 2000);
  });

  it("should apply custom template", () => {
    const email = makeEmail({ subject: "Test Subject", from: "test@ex.com" });
    const route = makeRoute({ formatTemplate: "New email: {subject} from {from}" });
    const result = formatEmailForZalo(email, route);
    assert.equal(result, "New email: Test Subject from test@ex.com");
  });

  it("should truncate to 2000 chars", () => {
    const email = makeEmail({ bodyText: "x".repeat(3000) });
    const route = makeRoute();
    const result = formatEmailForZalo(email, route);
    assert.ok(result.length <= 2000);
    assert.ok(result.endsWith("..."));
  });

  it("should show attachment info", () => {
    const email = makeEmail({
      hasAttachment: true,
      attachments: [{ filename: "report.pdf", mimeType: "application/pdf", size: 1024 }],
    });
    const route = makeRoute();
    const result = formatEmailForZalo(email, route);
    assert.ok(result.includes("report.pdf"));
    assert.ok(result.includes("attachment"));
  });
});

describe("generateRouteId", () => {
  it("should generate unique IDs", () => {
    const id1 = generateRouteId();
    const id2 = generateRouteId();
    assert.notEqual(id1, id2);
    assert.ok(id1.startsWith("route_"));
  });
});
