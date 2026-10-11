/**
 * One owner conversation per client and agent.
 * A legacy shared key is moved onto the agent that wrote it, or the Financial Manager.
 */
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";

export type OwnerChatMessage = { role: "owner" | "agent"; text: string };

export type OwnerAgentThread = {
  messages: OwnerChatMessage[];
  draft: string;
};

export type OwnerAskHistoryTurn = { role: "user" | "assistant"; content: string };

export type ThreadStore = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const THREAD_PREFIX = "milon-owner-thread:";
const MESSAGE_CAP = 40;

export function ownerThreadKey(clientId: string, agent: AgentKey): string {
  return `${THREAD_PREFIX}${clientId}:${agent}`;
}

export function ownerLegacyThreadKey(clientId: string): string {
  return `${THREAD_PREFIX}${clientId}`;
}

export function emptyOwnerThreads(): Record<AgentKey, OwnerAgentThread> {
  return {
    financial_manager: { messages: [], draft: "" },
    analyst: { messages: [], draft: "" },
    advisor: { messages: [], draft: "" },
  };
}

export function memoryThreadStore(initial: Record<string, string> = {}): ThreadStore & {
  dump: () => Record<string, string>;
} {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
    dump: () => ({ ...data }),
  };
}

export function browserThreadStore(): ThreadStore {
  try {
    if (typeof localStorage === "undefined") return memoryThreadStore();
    const probe = "__milon_thread_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return memoryThreadStore();
  }
}

function isAgent(value: unknown): value is AgentKey {
  return value === "financial_manager" || value === "analyst" || value === "advisor";
}

function parseMessages(value: unknown): OwnerChatMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: OwnerChatMessage[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const role = (row as { role?: unknown }).role;
    const text = (row as { text?: unknown }).text;
    if ((role !== "owner" && role !== "agent") || typeof text !== "string" || !text.trim()) continue;
    messages.push({ role, text: text.slice(0, 8000) });
  }
  return messages.slice(-MESSAGE_CAP);
}

function parseThread(raw: string | null): OwnerAgentThread | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { messages?: unknown; draft?: unknown };
    return {
      messages: parseMessages(parsed.messages),
      draft: typeof parsed.draft === "string" ? parsed.draft.slice(0, 4000) : "",
    };
  } catch {
    return null;
  }
}

function threadIsEmpty(thread: OwnerAgentThread): boolean {
  return thread.messages.length === 0 && thread.draft === "";
}

function migrateLegacy(store: ThreadStore, clientId: string, threads: Record<AgentKey, OwnerAgentThread>) {
  const legacyKey = ownerLegacyThreadKey(clientId);
  const raw = store.getItem(legacyKey);
  if (!raw) return;
  let agent: AgentKey = "financial_manager";
  let incoming: OwnerAgentThread = { messages: [], draft: "" };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      incoming = { messages: parseMessages(parsed), draft: "" };
    } else if (parsed && typeof parsed === "object") {
      const record = parsed as { agent?: unknown; messages?: unknown; draft?: unknown };
      if (isAgent(record.agent)) agent = record.agent;
      incoming = {
        messages: parseMessages(record.messages),
        draft: typeof record.draft === "string" ? record.draft.slice(0, 4000) : "",
      };
    }
  } catch {
    store.removeItem(legacyKey);
    return;
  }
  if (threadIsEmpty(threads[agent]) && !threadIsEmpty(incoming)) {
    threads[agent] = incoming;
    writeOwnerThread(store, clientId, agent, incoming);
  }
  store.removeItem(legacyKey);
}

export function readOwnerThreads(store: ThreadStore, clientId: string): Record<AgentKey, OwnerAgentThread> {
  const threads = emptyOwnerThreads();
  if (!clientId.trim()) return threads;
  for (const agent of AGENT_KEYS) {
    const parsed = parseThread(store.getItem(ownerThreadKey(clientId, agent)));
    if (parsed) threads[agent] = parsed;
  }
  migrateLegacy(store, clientId, threads);
  return threads;
}

export function writeOwnerThread(
  store: ThreadStore,
  clientId: string,
  agent: AgentKey,
  thread: OwnerAgentThread,
): void {
  if (!clientId.trim()) return;
  const payload = {
    agent,
    messages: thread.messages.slice(-MESSAGE_CAP),
    draft: thread.draft.slice(0, 4000),
  };
  if (payload.messages.length === 0 && payload.draft === "") {
    store.removeItem(ownerThreadKey(clientId, agent));
    return;
  }
  store.setItem(ownerThreadKey(clientId, agent), JSON.stringify(payload));
}

export function historyFromThread(messages: OwnerChatMessage[]): OwnerAskHistoryTurn[] {
  return messages.slice(-8).map((turn) => ({
    role: turn.role === "owner" ? "user" : "assistant",
    content: turn.text.trim().slice(0, 1500),
  }));
}

export type OwnerChatDesk = {
  agent: () => AgentKey;
  messages: () => OwnerChatMessage[];
  draft: () => string;
  recording: () => AgentKey | null;
  setDraft: (value: string) => void;
  switchTo: (next: AgentKey) => void;
  startRecording: () => void;
  applyTranscript: (text: string) => boolean;
  send: (question: string) => { agent: AgentKey; question: string; history: OwnerAskHistoryTurn[] } | null;
  receive: (asked: AgentKey, answer: string) => void;
};

export function createOwnerChatDesk(store: ThreadStore, clientId: string): OwnerChatDesk {
  let agent: AgentKey = "financial_manager";
  let threads = readOwnerThreads(store, clientId);
  let recordingAgent: AgentKey | null = null;

  function persist(which: AgentKey) {
    writeOwnerThread(store, clientId, which, threads[which]);
  }

  return {
    agent: () => agent,
    messages: () => threads[agent].messages,
    draft: () => threads[agent].draft,
    recording: () => recordingAgent,
    setDraft(value) {
      threads = { ...threads, [agent]: { ...threads[agent], draft: value } };
      persist(agent);
    },
    switchTo(next) {
      recordingAgent = null;
      agent = next;
    },
    startRecording() {
      recordingAgent = agent;
    },
    applyTranscript(text) {
      if (recordingAgent !== agent) return false;
      threads = { ...threads, [agent]: { ...threads[agent], draft: text } };
      persist(agent);
      return true;
    },
    send(question) {
      const asked = agent;
      const text = question.trim();
      if (!text) return null;
      const prior = threads[asked].messages;
      threads = {
        ...threads,
        [asked]: { messages: [...prior, { role: "owner", text }], draft: "" },
      };
      persist(asked);
      return { agent: asked, question: text, history: historyFromThread(prior) };
    },
    receive(asked, answer) {
      const text = answer.trim();
      if (!text) return;
      threads = {
        ...threads,
        [asked]: {
          ...threads[asked],
          messages: [...threads[asked].messages, { role: "agent", text }],
        },
      };
      persist(asked);
    },
  };
}
