/**
 * Agent-tab chat. A right-hand panel on a wide screen, and a bottom dock
 * on a narrow one. The composer stays on screen. Drafts go to the review
 * inbox. This panel does not send or approve.
 */

import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import {
  LIGHTHOUSE_CHAT_PROMPTS,
  clearChatThread,
  composerShouldSend,
  newChatMessageId,
  readChatThread,
  writeChatThread,
  type ChatChip,
  type ChatMessage,
} from "@/lib/lighthouse-agent-chat";
import { askLighthouseAgent } from "@/lib/lighthouse-agent-chat.functions";

export function LighthouseAgentChat({
  adminKey,
  onOpenLead,
  onOpenReview,
  onDrafted,
}: {
  adminKey: string;
  onOpenLead: (leadId: string) => void;
  onOpenReview: (touchId: string, leadId: string) => void;
  onDrafted: () => Promise<void> | void;
}) {
  const ask = useServerFn(askLighthouseAgent);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setMessages(readChatThread(window.localStorage, adminKey));
    setHydrated(true);
  }, [adminKey]);

  useEffect(() => {
    if (!hydrated) return;
    writeChatThread(window.localStorage, adminKey, messages);
  }, [adminKey, hydrated, messages]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, busy, mobileOpen, collapsed]);

  const showThread = collapsed ? false : mobileOpen ? true : undefined;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError("");
    setMobileOpen(true);
    try {
      const result = await ask({
        data: {
          message,
          history: messages.slice(-8).map((row) => ({ role: row.role, content: row.content })),
        },
      });
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { id: newChatMessageId(), role: "user", content: message, chips: [], createdAt: now },
        {
          id: newChatMessageId(),
          role: "assistant",
          content: result.reply,
          chips: result.chips ?? [],
          createdAt: now,
        },
      ]);
      setInput("");
      if (result.draft?.touchId) await onDrafted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not ask Lighthouse.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const clear = () => {
    setMessages([]);
    setError("");
    clearChatThread(window.localStorage, adminKey);
  };

  const openChip = (chip: ChatChip) => {
    if (chip.kind === "review") onOpenReview(chip.id, chip.leadId);
    else onOpenLead(chip.leadId);
  };

  return (
    <LighthouseAgentChatView
      messages={messages}
      input={input}
      busy={busy}
      error={error}
      showThread={showThread}
      collapsed={collapsed}
      threadRef={threadRef}
      inputRef={inputRef}
      onInput={setInput}
      onToggleMobile={() => setMobileOpen((open) => !open)}
      onToggleCollapse={() => setCollapsed((open) => !open)}
      mobileOpen={mobileOpen}
      onSend={() => void send(input)}
      onPrompt={(prompt) => {
        if (prompt.startsWith("Draft a follow-up")) {
          setInput("Draft a follow-up for ");
          setMobileOpen(true);
          inputRef.current?.focus();
          return;
        }
        void send(prompt);
      }}
      onClear={clear}
      onChip={openChip}
      onKeyDown={(event) => {
        if (!composerShouldSend(event.key, event.shiftKey)) return;
        event.preventDefault();
        void send(input);
      }}
    />
  );
}

export function LighthouseAgentChatView({
  messages,
  input,
  busy,
  error,
  showThread,
  collapsed,
  mobileOpen,
  threadRef,
  inputRef,
  onInput,
  onToggleMobile,
  onToggleCollapse,
  onSend,
  onPrompt,
  onClear,
  onChip,
  onKeyDown,
}: {
  messages: ChatMessage[];
  input: string;
  busy: boolean;
  error: string;
  /** undefined = wide default (thread visible from xl up). */
  showThread?: boolean;
  collapsed: boolean;
  mobileOpen: boolean;
  threadRef?: { current: HTMLDivElement | null };
  inputRef?: { current: HTMLTextAreaElement | null };
  onInput: (value: string) => void;
  onToggleMobile: () => void;
  onToggleCollapse: () => void;
  onSend: () => void;
  onPrompt: (prompt: string) => void;
  onClear: () => void;
  onChip: (chip: ChatChip) => void;
  onKeyDown: (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => void;
}) {
  const threadClass =
    showThread === false
      ? "hidden"
      : showThread === true
        ? "flex min-h-0 flex-1 flex-col"
        : collapsed
          ? "hidden"
          : "hidden xl:flex xl:min-h-0 xl:flex-1 xl:flex-col";

  return (
    <aside
      className="flex max-h-[min(70vh,36rem)] flex-col rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] shadow-[0_12px_40px_rgba(15,23,42,0.08)] max-xl:fixed max-xl:inset-x-3 max-xl:bottom-3 max-xl:z-30 xl:sticky xl:top-4 xl:max-h-[calc(100vh-5.5rem)]"
      aria-label="Lighthouse chat"
    >
      <div className="flex items-center gap-2 border-b border-[var(--ops-line)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
            Lighthouse
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleMobile}
          className="rounded-full border border-[var(--ops-line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ops-ink-soft)] xl:hidden"
        >
          {mobileOpen ? "Hide" : "Open"}
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="hidden rounded-full border border-[var(--ops-line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ops-ink-soft)] xl:inline"
        >
          {collapsed ? "Open" : "Collapse"}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-full border border-[var(--ops-line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ops-ink-soft)]"
        >
          Clear
        </button>
      </div>

      <div className={threadClass}>
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {LIGHTHOUSE_CHAT_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={busy}
              onClick={() => onPrompt(prompt)}
              className="rounded-full border border-[var(--ops-line)] px-2.5 py-1 text-left text-[11px] text-[var(--ops-ink-soft)] hover:border-[var(--ops-amber-border)] disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
        <div ref={threadRef} className="min-h-[8rem] flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {messages.length === 0 && !busy && (
            <p className="text-[12px] leading-relaxed text-[var(--ops-ink-dim)]">
              Ask about the due queue, replies, or the pipeline. A draft lands in the review inbox.
              Nothing is sent from here.
            </p>
          )}
          {messages.map((message) => (
            <div key={message.id} className={message.role === "user" ? "text-right" : "text-left"}>
              <div
                className={`inline-block max-w-full whitespace-pre-wrap rounded-2xl px-3 py-2 text-left text-[13px] leading-relaxed ${
                  message.role === "user"
                    ? "bg-[var(--ops-amber-soft)] text-[var(--ops-ink)]"
                    : "bg-[var(--ops-bg)] text-[var(--ops-ink)]"
                }`}
              >
                {message.content}
              </div>
              {message.chips.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {message.chips.map((chip) => (
                    <button
                      key={`${chip.kind}-${chip.id}`}
                      type="button"
                      onClick={() => onChip(chip)}
                      className="rounded-full border border-[var(--ops-amber-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ops-amber)]"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--ops-ink-dim)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ops-amber)]" />
              Looking at the book…
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="mx-3 mb-2 rounded-xl border border-[var(--ops-danger-border)] bg-[var(--ops-danger-bg)] px-3 py-2 text-[12px] text-[var(--ops-danger-ink)]" role="alert">
          {error}
        </p>
      )}

      <form
        className="border-t border-[var(--ops-line)] p-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <label className="sr-only" htmlFor="lighthouse-agent-chat-input">
          Message Lighthouse
        </label>
        <textarea
          id="lighthouse-agent-chat-input"
          ref={inputRef}
          rows={2}
          value={input}
          disabled={busy}
          placeholder="Ask Lighthouse"
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={onKeyDown}
          className="ops-input max-h-28 min-h-[2.75rem] w-full resize-none py-2"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] text-[var(--ops-ink-faint)]">Enter to send · Shift+Enter for a new line</span>
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full bg-[var(--ops-amber-soft)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--ops-amber)] disabled:opacity-40"
          >
            Ask
          </button>
        </div>
      </form>
    </aside>
  );
}
