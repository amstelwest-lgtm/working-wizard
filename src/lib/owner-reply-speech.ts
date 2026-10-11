/**
 * A reply is spoken only when the owner taps Listen on that message.
 * Arriving replies and voice input never start speech. Nothing here reads storage.
 */

export type SpeechUtterance = {
  text: string;
  onend: () => void;
  onerror: () => void;
};

export type SpeechPort = {
  cancel: () => void;
  speak: (utterance: SpeechUtterance) => void;
};

export type SpeechHooks = {
  onPlay: () => void;
  onStop: () => void;
};

export type ReplySpeech = {
  noteReply: () => void;
  noteVoiceInput: () => void;
  activeId: () => string | null;
  stop: () => void;
  tap: (messageId: string, text: string, hooks: SpeechHooks) => "playing" | "stopped" | "unavailable";
};

export function createReplySpeech(port: SpeechPort | null): ReplySpeech {
  let activeId: string | null = null;
  let generation = 0;
  let stopHook: (() => void) | null = null;

  function finish(gen: number) {
    if (gen !== generation) return;
    activeId = null;
    const hook = stopHook;
    stopHook = null;
    hook?.();
  }

  const speech: ReplySpeech = {
    noteReply() {},
    noteVoiceInput() {},
    activeId: () => activeId,
    stop() {
      if (!activeId && !stopHook) return;
      generation += 1;
      activeId = null;
      const hook = stopHook;
      stopHook = null;
      port?.cancel();
      hook?.();
    },
    tap(messageId, text, hooks) {
      if (!port || !text.trim()) return "unavailable";
      if (activeId === messageId) {
        speech.stop();
        return "stopped";
      }
      if (activeId) speech.stop();
      const gen = ++generation;
      activeId = messageId;
      stopHook = hooks.onStop;
      hooks.onPlay();
      port.speak({
        text,
        onend: () => finish(gen),
        onerror: () => finish(gen),
      });
      return "playing";
    },
  };
  return speech;
}

export function browserSpeechPort(): SpeechPort | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const synth = window.speechSynthesis;
  return {
    cancel() {
      synth.cancel();
    },
    speak(utterance) {
      const next = new SpeechSynthesisUtterance(utterance.text);
      next.onend = () => utterance.onend();
      next.onerror = () => utterance.onerror();
      synth.speak(next);
    },
  };
}
