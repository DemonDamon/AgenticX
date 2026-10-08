import { describe, expect, it } from "vitest";
import {
  buildClarifyRequestBody,
  buildDecisionFormAnswer,
  isDecisionFormComplete,
  isValidClarifyUrl,
  parseClarificationDecisions,
  type DecisionFormState,
} from "./clarification-notice";

/** Comate-style connector form emitted by the connector-assistant skill. */
const RAW_CONNECTOR_FORM = [
  {
    id: "system_type",
    question: "abc 要接入的是什么类型的系统？",
    options: ["REST API（提供 HTTP 接口文档）", "MCP Server（提供 MCP 接入 URL）", "数据库直连（需手动配置）", "其他（自定义输入）"],
    custom_option: "其他（自定义输入）",
  },
  {
    id: "auth",
    question: "该系统的认证方式是什么？",
    options: ["无需认证", "Bearer Token", "自定义请求头", "Query 参数", "AK/SK 签名", "OAuth 2.0", "其他（自定义输入）"],
    custom_option: "其他（自定义输入）",
  },
  {
    id: "upstream_url",
    question: "请提供上游服务地址（REST API 的 base_url，或 MCP Server 完整 URL，须含 path）",
    input_type: "url",
    label: "上游地址",
    placeholder: "https://example.com/api 或 https://example.com/mcp",
  },
];

const empty = (): DecisionFormState => ({ selected: {}, custom: {} });

describe("parseClarificationDecisions form extensions", () => {
  it("keeps option-less url fields and custom option metadata", () => {
    const out = parseClarificationDecisions(RAW_CONNECTOR_FORM);
    expect(out).toHaveLength(3);
    expect(out[0]!.customOption).toBe("其他（自定义输入）");
    expect(out[0]!.inputType).toBeUndefined();
    expect(out[2]).toMatchObject({
      id: "upstream_url",
      inputType: "url",
      options: [],
      label: "上游地址",
      placeholder: "https://example.com/api 或 https://example.com/mcp",
    });
  });

  it("stays backward compatible for legacy choice payloads", () => {
    const out = parseClarificationDecisions([
      { question: "无选项的旧决策", options: [] },
      { id: "x", question: "q", options: ["A", "B"], custom_option: "C" },
    ]);
    expect(out).toEqual([
      { id: "x", question: "q", options: ["A", "B"], selectionMode: "single", exclusiveOptions: [] },
    ]);
  });

  it("parses secret fields without options and honours required=false", () => {
    const out = parseClarificationDecisions([
      { id: "credential", question: "Token", input_type: "secret", options: ["leak"] },
      { id: "note", question: "备注", input_type: "text", required: false },
    ]);
    expect(out[0]).toMatchObject({ inputType: "secret", options: [] });
    expect(out[1]!.required).toBe(false);
  });
});

describe("decision form gating and answers", () => {
  const decisions = parseClarificationDecisions(RAW_CONNECTOR_FORM);

  it("disables confirm until required fields are filled and the URL is valid", () => {
    const state = empty();
    expect(isDecisionFormComplete(decisions, state, false)).toBe(false);
    state.selected.system_type = ["MCP Server（提供 MCP 接入 URL）"];
    state.selected.auth = ["Bearer Token"];
    expect(isDecisionFormComplete(decisions, state, false)).toBe(false);
    state.custom.upstream_url = "example.com/mcp";
    expect(isDecisionFormComplete(decisions, state, false)).toBe(false);
    state.custom.upstream_url = "https://example.com/mcp";
    expect(isDecisionFormComplete(decisions, state, false)).toBe(true);
  });

  it("requires text when the custom option is selected and uses it as the value", () => {
    const state: DecisionFormState = {
      selected: { system_type: ["其他（自定义输入）"], auth: ["无需认证"] },
      custom: { upstream_url: "https://h.example.com/mcp" },
    };
    expect(isDecisionFormComplete(decisions, state, false)).toBe(false);
    state.custom.system_type = "GraphQL 网关";
    expect(isDecisionFormComplete(decisions, state, false)).toBe(true);
    const answer = buildDecisionFormAnswer(decisions, state, false);
    expect(answer.selectedOptions).toEqual([
      "abc 要接入的是什么类型的系统？：GraphQL 网关",
      "该系统的认证方式是什么？：无需认证",
      "请提供上游服务地址（REST API 的 base_url，或 MCP Server 完整 URL，须含 path）：https://h.example.com/mcp",
    ]);
    expect(answer.secretValues).toBeUndefined();
  });

  it("keeps the legacy grouped answer format for plain choice decisions", () => {
    const legacy = parseClarificationDecisions([{ id: "d", question: "时长", options: ["1 分钟", "2 分钟"] }]);
    const answer = buildDecisionFormAnswer(legacy, { selected: { d: ["2 分钟"] }, custom: { d: "加片尾" } }, true);
    expect(answer.selectedOptions).toEqual(["时长：2 分钟（补充：加片尾）"]);
  });

  it("routes secret values to secretValues only and masks them in the answer text", () => {
    const secretForm = parseClarificationDecisions([
      { id: "credential", question: "请输入 Token", input_type: "secret" },
    ]);
    const state: DecisionFormState = { selected: {}, custom: { credential: "sk-SECRET-123" } };
    expect(isDecisionFormComplete(secretForm, state, false)).toBe(true);
    const answer = buildDecisionFormAnswer(secretForm, state, false, "已填写（已隐藏）");
    expect(answer.selectedOptions).toEqual(["请输入 Token：已填写（已隐藏）"]);
    expect(JSON.stringify(answer.selectedOptions)).not.toContain("sk-SECRET-123");
    expect(answer.secretValues).toEqual({ credential: "sk-SECRET-123" });
    const body = buildClarifyRequestBody({ sessionId: "s", requestId: "r", answer });
    expect(body.secret_values).toEqual({ credential: "sk-SECRET-123" });
    expect(body.answer_text).toBe("");
  });

  it("omits secret_values from the request body when absent", () => {
    const body = buildClarifyRequestBody({
      sessionId: "s",
      requestId: "r",
      answer: { answerText: "", selectedOptions: ["a"] },
    });
    expect("secret_values" in body).toBe(false);
  });

  it("validates http(s) URLs", () => {
    expect(isValidClarifyUrl("https://example.com/mcp")).toBe(true);
    expect(isValidClarifyUrl("http://127.0.0.1:8080/sse")).toBe(true);
    expect(isValidClarifyUrl("example.com")).toBe(false);
    expect(isValidClarifyUrl("ftp://example.com")).toBe(false);
    expect(isValidClarifyUrl("https://exa mple.com")).toBe(false);
  });
});
