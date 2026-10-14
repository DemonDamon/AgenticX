import { describe, expect, it } from "vitest";

import { AgentValidationError, validateAgentInput, type AgentInput, type AgentRuntime } from "../agents";

const valid: AgentInput = {
  slug: "report-bot",
  displayName: "报告助手",
  model: "openai/gpt-4o",
  runtime: "cloud",
  systemPrompt: "你是报告助手",
  capabilityIds: ["skill:01ARZ3NDEKTSV4RRFFQ69G5FAV"],
  assignmentKeys: ["all"],
  status: "active",
};

describe("validateAgentInput", () => {
  it("rejects an illegal slug", () => {
    expect(() => validateAgentInput({ ...valid, slug: "Report_Bot" })).toThrow(AgentValidationError);
  });

  it("rejects an illegal runtime", () => {
    expect(() => validateAgentInput({ ...valid, runtime: "local" as AgentRuntime })).toThrow(AgentValidationError);
  });

  it("rejects an illegal capability id", () => {
    expect(() => validateAgentInput({ ...valid, capabilityIds: ["feature:web_search"] })).toThrow(
      AgentValidationError,
    );
  });

  it("accepts a legacy standard-base32 mcp id", () => {
    expect(() =>
      validateAgentInput({
        ...valid,
        capabilityIds: ["mcp:JIAHGIWLGRVNU42IBEQ7HGYMP4"],
      }),
    ).not.toThrow();
  });

  it("rejects an empty assignmentKeys array", () => {
    expect(() => validateAgentInput({ ...valid, assignmentKeys: [] })).toThrow(AgentValidationError);
  });

  it("accepts a legal input", () => {
    expect(() => validateAgentInput(valid)).not.toThrow();
  });

  it("accepts an empty workerKeys array", () => {
    expect(() => validateAgentInput({ ...valid, workerKeys: [] })).not.toThrow();
  });

  it("rejects a blank workerKeys entry", () => {
    expect(() => validateAgentInput({ ...valid, workerKeys: ["  "] })).toThrow(AgentValidationError);
  });

  it("rejects a non-array workerKeys", () => {
    expect(() => validateAgentInput({ ...valid, workerKeys: "all" as unknown as string[] })).toThrow(
      AgentValidationError,
    );
  });

  it("accepts an http knowledge search address and rejects other schemes", () => {
    expect(() =>
      validateAgentInput({ ...valid, metadata: { knowledgeSearchUrl: "https://kb.example/search" } }),
    ).not.toThrow();
    expect(() =>
      validateAgentInput({ ...valid, metadata: { knowledgeSearchUrl: "file:///tmp/notes" } }),
    ).toThrow(AgentValidationError);
  });
});
