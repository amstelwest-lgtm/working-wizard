/**
 * One-shot browser speech recognition (SpeechRecognition, or the webkit prefix).
 * The transcript is a draft. Callers send only when the person presses Ask or Send.
 */

export const VOICE_UNAVAILABLE = "Voice is not available in this browser.";
export const VOICE_MISSED = "Voice did not catch that.";

type SpeechResultEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export type BrowserSpeechSession = {
  stop: () => void;
};

function speechRecognition(): SpeechRec | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Start one recognition pass. Null when this browser has no speech API. */
export function startBrowserSpeech(options: {
  lang?: string;
  onTranscript: (transcript: string) => void;
  onMissed: () => void;
  onEnd: () => void;
}): BrowserSpeechSession | null {
  const rec = speechRecognition();
  if (!rec) return null;
  rec.lang = options.lang || "en";
  rec.interimResults = false;
  let stopped = false;
  rec.onresult = (event) => {
    if (stopped) return;
    const said = event.results[0]?.[0]?.transcript?.trim() ?? "";
    if (!said) return;
    options.onTranscript(said);
  };
  rec.onerror = () => {
    if (stopped) return;
    options.onMissed();
  };
  rec.onend = () => {
    if (stopped) return;
    options.onEnd();
  };
  try {
    rec.start();
  } catch {
    stopped = true;
    return null;
  }
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* already ended */
      }
    },
  };
}
