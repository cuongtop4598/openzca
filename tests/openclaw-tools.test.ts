import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TOOL_DEFINITIONS } from "../src/lib/openclaw-tools.js";

describe("TOOL_DEFINITIONS", () => {
  it("should have at least 10 tool definitions", () => {
    assert.ok(TOOL_DEFINITIONS.length >= 10, `Expected >=10 tools, got ${TOOL_DEFINITIONS.length}`);
  });

  it("should have unique tool names", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    const unique = new Set(names);
    assert.equal(unique.size, names.length, `Duplicate tool names found`);
  });

  it("every tool should have name, category, description, and params", () => {
    for (const tool of TOOL_DEFINITIONS) {
      assert.ok(tool.name, `Tool missing name`);
      assert.ok(tool.category, `Tool ${tool.name} missing category`);
      assert.ok(tool.description, `Tool ${tool.name} missing description`);
      assert.ok(Array.isArray(tool.params), `Tool ${tool.name} params should be array`);
    }
  });

  it("should include both data and analysis categories", () => {
    const categories = new Set(TOOL_DEFINITIONS.map((t) => t.category));
    assert.ok(categories.has("data"), "Missing 'data' category");
    assert.ok(categories.has("analysis"), "Missing 'analysis' category");
  });

  it("every param should have name, type, required, and description", () => {
    for (const tool of TOOL_DEFINITIONS) {
      for (const param of tool.params) {
        assert.ok(param.name, `Param missing name in tool ${tool.name}`);
        assert.ok(["string", "number", "boolean"].includes(param.type), `Invalid param type '${param.type}' in tool ${tool.name}`);
        assert.equal(typeof param.required, "boolean", `Param ${param.name} in tool ${tool.name} missing required flag`);
        assert.ok(param.description, `Param ${param.name} in tool ${tool.name} missing description`);
      }
    }
  });

  it("should include key tools for OpenClaw integration", () => {
    const names = new Set(TOOL_DEFINITIONS.map((t) => t.name));
    const expectedTools = [
      "group_list", "group_info", "group_members", "group_messages",
      "chat_list", "chat_messages", "friend_list", "db_status",
      "report_summary", "report_group", "report_activity", "report_member",
      "search_messages",
    ];
    for (const name of expectedTools) {
      assert.ok(names.has(name), `Missing expected tool: ${name}`);
    }
  });
});
