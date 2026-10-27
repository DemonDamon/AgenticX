import { MaApiError } from "./errors";
import { parseSse } from "./sse";
import type {
  AgentVersionRecord,
  CreateAgentInput,
  CreateSessionInput,
  EnvironmentRecord,
  MaAgentEnvelope,
  MaPreviewFrame,
  MaStoredEvent,
  MaStreamItem,
  SessionRecord,
  UpdateAgentPatch,
} from "./types";

export type ManagedAgentsClientOptions = {
  baseUrl: string;
  token: string;
  controlBaseUrl?: string;
  runtimeBaseUrl?: string;
  onBehalfOf?: string;
  fetch?: typeof fetch;
};

export type StreamOptions = {
  afterSeq?: number;
  includePreviews?: boolean;
  untilIdle?: boolean;
  maxReconnects?: number;
  signal?: AbortSignal;
};

const IDLE_TYPES = new Set(["session.status_idle", "session.status_terminated"]);

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redact(token: string, text: string): string {
  return token ? text.split(token).join("***") : text;
}

function isAbort(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function mapError(token: string, status: number, body: unknown): MaApiError {
  if (isRecord(body) && isRecord(body.error)) {
    const code = body.error.code;
    const message = body.error.message;
    if (typeof code === "string" && typeof message === "string") {
      const details = isRecord(body.error.details) ? body.error.details : null;
      return new MaApiError(status, code, redact(token, message), details);
    }
  }
  return new MaApiError(status, "http_error", `HTTP ${status}`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requireRecord(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) throw new MaApiError(0, "invalid_response", "invalid response");
  return payload;
}

function requireList(payload: unknown): unknown[] {
  const record = requireRecord(payload);
  if (!Array.isArray(record.data)) throw new MaApiError(0, "invalid_response", "invalid response");
  return record.data;
}

function cast<T>(value: unknown): T {
  return value as T;
}

export class ManagedAgentsClient {
  readonly agents: {
    list(filter?: { lifecycle?: string; status?: string }): Promise<MaAgentEnvelope[]>;
    get(agentId: string): Promise<MaAgentEnvelope>;
    create(input: CreateAgentInput): Promise<MaAgentEnvelope & { version: AgentVersionRecord }>;
    update(agentId: string, patch: UpdateAgentPatch): Promise<MaAgentEnvelope>;
  };
  readonly versions: {
    list(
      agentId: string,
      opts?: { limit?: number; beforeVersion?: number },
    ): Promise<{ data: AgentVersionRecord[]; nextBeforeVersion: number | null }>;
    get(agentId: string, version: number): Promise<AgentVersionRecord>;
    create(
      agentId: string,
      input: { manifest: Record<string, unknown>; expectedLatestVersion: number; note?: string },
    ): Promise<{ version: AgentVersionRecord; created: boolean }>;
  };
  readonly environments: {
    list(): Promise<EnvironmentRecord[]>;
    get(envId: string): Promise<EnvironmentRecord>;
  };
  readonly sessions: {
    create(input: CreateSessionInput): Promise<SessionRecord>;
    get(sessionId: string): Promise<SessionRecord>;
    list(opts?: { agentId?: string; limit?: number; scope?: "mine" | "tenant" }): Promise<SessionRecord[]>;
    archive(sessionId: string): Promise<SessionRecord>;
  };
  readonly events: {
    list(
      sessionId: string,
      opts?: { afterSeq?: number; limit?: number; types?: string[] },
    ): Promise<{ data: MaStoredEvent[]; hasMore: boolean; nextAfterSeq: number | null }>;
    send(sessionId: string, events: Array<Record<string, unknown>>): Promise<MaStoredEvent[]>;
    stream(sessionId: string, opts?: StreamOptions): AsyncGenerator<MaStreamItem>;
  };

  private readonly token: string;
  private readonly control: string;
  private readonly runtime: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onBehalfOf: string | undefined;

  constructor(options: ManagedAgentsClientOptions) {
    if (!options.token.startsWith("agx-pat-")) {
      throw new MaApiError(0, "invalid_token", "token must be an agx-pat- personal access token");
    }
    this.token = options.token;
    this.control = `${trimSlash(options.controlBaseUrl ?? options.baseUrl)}/ma/v1`;
    this.runtime = `${trimSlash(options.runtimeBaseUrl ?? options.baseUrl)}/ma/v1`;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.onBehalfOf = options.onBehalfOf;
    this.agents = {
      list: (filter) => this.listAgents(filter),
      get: (agentId) => this.getAgent(agentId),
      create: (input) => this.createAgent(input),
      update: (agentId, patch) => this.updateAgent(agentId, patch),
    };
    this.versions = {
      list: (agentId, opts) => this.listVersions(agentId, opts),
      get: (agentId, version) => this.getVersion(agentId, version),
      create: (agentId, input) => this.createVersion(agentId, input),
    };
    this.environments = {
      list: () => this.listEnvironments(),
      get: (envId) => this.getEnvironment(envId),
    };
    this.sessions = {
      create: (input) => this.createSession(input),
      get: (sessionId) => this.getSession(sessionId),
      list: (opts) => this.listSessions(opts),
      archive: (sessionId) => this.archiveSession(sessionId),
    };
    this.events = {
      list: (sessionId, opts) => this.listEvents(sessionId, opts),
      send: (sessionId, events) => this.sendEvents(sessionId, events),
      stream: (sessionId, opts) => this.streamEvents(sessionId, opts),
    };
  }

  private path(root: string, ...parts: string[]): string {
    return `${root}/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
  }

  private async request(
    method: string,
    url: string,
    options?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      ...(options?.headers ?? {}),
    };
    let body: string | undefined;
    if (options && "body" in options) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, headers, body });
    } catch (error) {
      const raw = error instanceof Error ? String(error) : String(error);
      throw new MaApiError(0, "network_error", redact(this.token, raw));
    }
    if (!response.ok) throw await this.readError(response);
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new MaApiError(response.status, "invalid_response", "invalid response");
    }
  }

  private async readError(response: Response): Promise<MaApiError> {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return mapError(this.token, response.status, body);
  }

  private async listAgents(filter?: { lifecycle?: string; status?: string }): Promise<MaAgentEnvelope[]> {
    const params = new URLSearchParams();
    if (filter?.lifecycle) params.set("lifecycle", filter.lifecycle);
    if (filter?.status) params.set("status", filter.status);
    const query = params.toString();
    const payload = await this.request("GET", `${this.control}/agents${query ? `?${query}` : ""}`);
    return requireList(payload) as MaAgentEnvelope[];
  }

  private async getAgent(agentId: string): Promise<MaAgentEnvelope> {
    const payload = await this.request("GET", this.path(this.control, "agents", agentId));
    return requireRecord(payload) as MaAgentEnvelope;
  }

  private async createAgent(
    input: CreateAgentInput,
  ): Promise<MaAgentEnvelope & { version: AgentVersionRecord }> {
    const payload = await this.request("POST", `${this.control}/agents`, { body: input });
    return requireRecord(payload) as MaAgentEnvelope & { version: AgentVersionRecord };
  }

  private async updateAgent(agentId: string, patch: UpdateAgentPatch): Promise<MaAgentEnvelope> {
    const payload = await this.request("PATCH", this.path(this.control, "agents", agentId), { body: patch });
    return requireRecord(payload) as MaAgentEnvelope;
  }

  private async listVersions(
    agentId: string,
    opts?: { limit?: number; beforeVersion?: number },
  ): Promise<{ data: AgentVersionRecord[]; nextBeforeVersion: number | null }> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.beforeVersion !== undefined) params.set("before_version", String(opts.beforeVersion));
    const query = params.toString();
    const url = `${this.path(this.control, "agents", agentId, "versions")}${query ? `?${query}` : ""}`;
    const payload = requireRecord(await this.request("GET", url));
    if (!Array.isArray(payload.data)) throw new MaApiError(0, "invalid_response", "invalid response");
    const next = payload.next_before_version;
    return {
      data: payload.data as AgentVersionRecord[],
      nextBeforeVersion: typeof next === "number" ? next : null,
    };
  }

  private async getVersion(agentId: string, version: number): Promise<AgentVersionRecord> {
    const payload = requireRecord(
      await this.request("GET", this.path(this.control, "agents", agentId, "versions", String(version))),
    );
    const inner = payload.version;
    if (!isRecord(inner)) throw new MaApiError(0, "invalid_response", "invalid response");
    return cast<AgentVersionRecord>(inner);
  }

  private async createVersion(
    agentId: string,
    input: { manifest: Record<string, unknown>; expectedLatestVersion: number; note?: string },
  ): Promise<{ version: AgentVersionRecord; created: boolean }> {
    const body: Record<string, unknown> = {
      manifest: input.manifest,
      expected_latest_version: input.expectedLatestVersion,
    };
    if (input.note !== undefined) body.note = input.note;
    const payload = requireRecord(
      await this.request("POST", this.path(this.control, "agents", agentId, "versions"), { body }),
    );
    if (!isRecord(payload.version) || typeof payload.created !== "boolean") {
      throw new MaApiError(0, "invalid_response", "invalid response");
    }
    return { version: cast<AgentVersionRecord>(payload.version), created: payload.created };
  }

  private async listEnvironments(): Promise<EnvironmentRecord[]> {
    return requireList(await this.request("GET", `${this.control}/environments`)) as EnvironmentRecord[];
  }

  private async getEnvironment(envId: string): Promise<EnvironmentRecord> {
    const payload = requireRecord(await this.request("GET", this.path(this.control, "environments", envId)));
    if (!isRecord(payload.environment)) throw new MaApiError(0, "invalid_response", "invalid response");
    return cast<EnvironmentRecord>(payload.environment);
  }

  private async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const headers: Record<string, string> = {};
    if (this.onBehalfOf) headers["x-agenticx-on-behalf-of"] = this.onBehalfOf;
    const payload = await this.request("POST", `${this.runtime}/sessions`, { body: input, headers });
    return cast<SessionRecord>(requireRecord(payload));
  }

  private async getSession(sessionId: string): Promise<SessionRecord> {
    const payload = await this.request("GET", this.path(this.runtime, "sessions", sessionId));
    return cast<SessionRecord>(requireRecord(payload));
  }

  private async listSessions(opts?: {
    agentId?: string;
    limit?: number;
    scope?: "mine" | "tenant";
  }): Promise<SessionRecord[]> {
    const params = new URLSearchParams();
    if (opts?.agentId) params.set("agent_id", opts.agentId);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.scope) params.set("scope", opts.scope);
    const query = params.toString();
    const payload = await this.request("GET", `${this.runtime}/sessions${query ? `?${query}` : ""}`);
    return requireList(payload) as SessionRecord[];
  }

  private async archiveSession(sessionId: string): Promise<SessionRecord> {
    const payload = await this.request("POST", this.path(this.runtime, "sessions", sessionId, "archive"));
    return cast<SessionRecord>(requireRecord(payload));
  }

  private async listEvents(
    sessionId: string,
    opts?: { afterSeq?: number; limit?: number; types?: string[] },
  ): Promise<{ data: MaStoredEvent[]; hasMore: boolean; nextAfterSeq: number | null }> {
    const params = new URLSearchParams();
    if (opts?.afterSeq !== undefined) params.set("after_seq", String(opts.afterSeq));
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    for (const eventType of opts?.types ?? []) params.append("types", eventType);
    const query = params.toString();
    const url = `${this.path(this.runtime, "sessions", sessionId, "events")}${query ? `?${query}` : ""}`;
    const payload = requireRecord(await this.request("GET", url));
    if (!Array.isArray(payload.data)) throw new MaApiError(0, "invalid_response", "invalid response");
    const next = payload.next_after_seq;
    return {
      data: payload.data as MaStoredEvent[],
      hasMore: payload.has_more === true,
      nextAfterSeq: typeof next === "number" ? next : null,
    };
  }

  private async sendEvents(sessionId: string, events: Array<Record<string, unknown>>): Promise<MaStoredEvent[]> {
    const payload = requireRecord(
      await this.request("POST", this.path(this.runtime, "sessions", sessionId, "events"), { body: events }),
    );
    if (!Array.isArray(payload.events)) throw new MaApiError(0, "invalid_response", "invalid response");
    return payload.events as MaStoredEvent[];
  }

  private async *streamEvents(sessionId: string, opts: StreamOptions = {}): AsyncGenerator<MaStreamItem> {
    const maxReconnects = opts.maxReconnects ?? 5;
    const includePreviews = opts.includePreviews === true;
    const untilIdle = opts.untilIdle === true;
    let lastSeq = opts.afterSeq ?? 0;
    let reconnects = 0;
    const encoded = encodeURIComponent(sessionId);
    const url = `${this.runtime}/sessions/${encoded}/events/stream${
      includePreviews ? "?event_deltas[]=agent.message" : ""
    }`;

    const waitOrStop = async (): Promise<"retry" | "stop"> => {
      reconnects += 1;
      if (reconnects > maxReconnects) {
        throw new MaApiError(0, "stream_disconnected", "event stream disconnected");
      }
      await sleep(Math.min(1000 * 2 ** (reconnects - 1), 10000), opts.signal);
      if (opts.signal?.aborted) return "stop";
      return "retry";
    };

    for (;;) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${this.token}`,
        accept: "text/event-stream",
      };
      if (lastSeq > 0) headers["last-event-id"] = String(lastSeq);
      let response: Response;
      try {
        response = await this.fetchImpl(url, { headers, signal: opts.signal });
      } catch (error) {
        if (opts.signal?.aborted || isAbort(error)) return;
        if ((await waitOrStop()) === "stop") return;
        continue;
      }
      if (response.status >= 400 && response.status < 500) {
        throw await this.readError(response);
      }
      if (!response.ok || !response.body) {
        if ((await waitOrStop()) === "stop") return;
        continue;
      }
      try {
        for await (const frame of parseSse(response.body)) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(frame.data);
          } catch {
            continue;
          }
          if (!isRecord(parsed)) continue;
          if (frame.id === null) {
            if (includePreviews) yield { kind: "preview", frame: parsed as MaPreviewFrame };
            continue;
          }
          const seq = Number(frame.id);
          if (!Number.isInteger(seq) || seq <= lastSeq) continue;
          lastSeq = seq;
          reconnects = 0;
          yield { kind: "event", event: cast<MaStoredEvent>(parsed) };
          if (untilIdle && typeof parsed.type === "string" && IDLE_TYPES.has(parsed.type)) return;
        }
      } catch (error) {
        if (opts.signal?.aborted || isAbort(error)) return;
      }
      if ((await waitOrStop()) === "stop") return;
    }
  }
}
