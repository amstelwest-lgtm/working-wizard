/**
 * Which clip the Financial Manager, Analyst, and Advisor play.
 * Runs, findings, and hand-off messages are the signals the owner and
 * accountant homes already load. The same mapping applies to all three.
 * Surprised is a real clip, and nothing in those signals means surprise,
 * so it stays unmapped. Calm, curious, and pleased are idle flourishes.
 */
import {
  draftFindingLabel,
  DRAFT_NEEDS_ACCOUNTANT,
  DRAFT_NEEDS_OWNER,
} from "@/hooks/owner-agent-ui";

export const FM_AVATAR_CLIPS = [
  "idle",
  "thinking",
  "done",
  "reading",
  "working",
  "found-issue",
  "idea",
  "waiting",
  "handoff",
  "pleased",
  "concerned",
  "curious",
  "surprised",
  "calm",
] as const;

export type FmAvatarClip = (typeof FM_AVATAR_CLIPS)[number];

/** Character faces that share one player. Folders match public/avatars. */
export const AVATAR_FOLDERS = {
  financial_manager: "fm",
  analyst: "analyst",
  advisor: "advisor",
} as const;

export type AvatarFace = keyof typeof AVATAR_FOLDERS;

/**
 * Clips are 24fps. Financial Manager files are 121 frames (5.042s).
 * Analyst and Advisor files are 120 frames (5s). The end check uses the
 * file's own duration, so both lengths swap on their last frame.
 */
export const AVATAR_CLIP_FPS = 24;

export function avatarPoster(agent: AvatarFace = "financial_manager") {
  const folder = AVATAR_FOLDERS[agent];
  return {
    webp: `/avatars/${folder}/${folder}-poster.webp`,
    jpg: `/avatars/${folder}/${folder}-poster.jpg`,
  };
}

export const FM_POSTER = avatarPoster("financial_manager");

export const FM_CROSSFADE_MS = 300;

/** Inserted between idle plays so the rest pose does not repeat. */
export const FM_IDLE_FLOURISHES = ["calm", "curious", "pleased"] as const;

export type FmIdleFlourish = (typeof FM_IDLE_FLOURISHES)[number];

const INGEST = new Set(["sync", "upload"]);
const IN_PROGRESS = new Set(["queued", "running"]);
const FINISHED = new Set(["succeeded", "partial"]);

export type FmAvatarRun = {
  status: string;
  trigger?: string | null;
  queued_at: string;
  finished_at?: string | null;
};

export type FmAvatarFinding = {
  kind?: string | null;
  severity?: string | null;
  evidence: unknown;
  created_at: string;
};

export type FmAvatarTalk = "working" | "speaking" | "listening" | null;

function stamp(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Date.parse(value);
  return Number.isNaN(n) ? 0 : n;
}

function evidenceKind(evidence: unknown): string {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return "";
  const kind = (evidence as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind.trim() : "";
}

/** Draft kind on the column, or on evidence when the column was not selected. */
function findingKind(row: FmAvatarFinding): string {
  return (row.kind ?? "").trim() || evidenceKind(row.evidence);
}

/**
 * An issue, a draft, or a suggestion. Info is a stored fact, not an issue,
 * so the caller can still show done for the run that wrote it.
 */
export function fmFindingClip(row: FmAvatarFinding): FmAvatarClip | null {
  const kind = findingKind(row);
  if (kind === "accountant_handoff_draft") return "handoff";
  if (kind === "next_move_draft" || kind === "advisory_deliverable_draft") return "idea";
  if (kind === "data_request_draft" || kind === "action_point_draft") return "waiting";
  const needs = draftFindingLabel(row);
  if (needs === DRAFT_NEEDS_OWNER || needs === DRAFT_NEEDS_ACCOUNTANT) return "waiting";
  const severity = (row.severity ?? "").trim();
  if (severity === "act") return "found-issue";
  if (severity === "watch") return "concerned";
  if (severity === "info") return null;
  return "found-issue";
}

export function fmClipSources(
  clip: FmAvatarClip,
  agent: AvatarFace = "financial_manager",
): { webm: string; mp4: string } {
  const folder = AVATAR_FOLDERS[agent];
  return {
    webm: `/avatars/${folder}/${folder}-${clip}.webm`,
    mp4: `/avatars/${folder}/${folder}-${clip}.mp4`,
  };
}

/**
 * True once playback is on the last frame of this file.
 * A 120-frame clip and a 121-frame clip both end here, using `duration`
 * rather than a fixed length. An unknown duration does not count.
 */
export function avatarClipAtEnd(
  currentTime: number,
  duration: number,
  fps = AVATAR_CLIP_FPS,
): boolean {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0 || fps <= 0) {
    return false;
  }
  return currentTime + 1 / fps >= duration - 0.001;
}

/**
 * Activity clip for one agent. The same signals drive all three faces.
 * A live run wins. Otherwise the newest of the finding, the hand-off,
 * and a clean finish wins. Speaking has no clip: the avatar stays silent.
 */
export function fmAvatarClip(input: {
  talk?: FmAvatarTalk;
  run?: FmAvatarRun | null;
  finding?: FmAvatarFinding | null;
  handoff?: { at: string } | null;
}): FmAvatarClip {
  if (input.talk === "listening") return "waiting";
  if (input.talk === "working") return "thinking";

  const run = input.run ?? null;
  if (run && IN_PROGRESS.has(run.status)) {
    const trigger = (run.trigger ?? "").trim().toLowerCase();
    if (INGEST.has(trigger)) return "reading";
    return run.status === "queued" ? "thinking" : "working";
  }

  const marks: { at: number; clip: FmAvatarClip }[] = [];
  const fromFinding = input.finding ? fmFindingClip(input.finding) : null;
  if (input.finding && fromFinding) {
    marks.push({ at: stamp(input.finding.created_at), clip: fromFinding });
  }
  if (input.handoff) marks.push({ at: stamp(input.handoff.at), clip: "handoff" });
  if (run && FINISHED.has(run.status)) {
    const covered =
      input.finding && fromFinding && stamp(input.finding.created_at) >= stamp(run.queued_at);
    if (!covered) {
      marks.push({ at: stamp(run.finished_at) || stamp(run.queued_at), clip: "done" });
    }
  }
  if (!marks.length) return "idle";
  marks.sort((a, b) => b.at - a.at || (a.clip === "done" ? 1 : 0) - (b.clip === "done" ? 1 : 0));
  return marks[0].clip;
}

/**
 * Preview and chat can force a motion without a new run. A real activity
 * clip still wins. Speaking stays on idle when nothing else is going on.
 */
export function displayFmClip(clip: FmAvatarClip | null | undefined, motion: string): FmAvatarClip {
  if (clip && clip !== "idle") return clip;
  if (motion === "working") return "working";
  if (motion === "found") return "found-issue";
  if (motion === "listening") return "waiting";
  return "idle";
}

/** 2, 3, or 4. `roll` is in [0, 1). */
export function fmIdleBudget(roll: number): number {
  const n = Math.floor(roll * 3);
  return 2 + Math.min(2, Math.max(0, n));
}

export function fmIdleFlourish(roll: number): FmIdleFlourish {
  const n = Math.floor(roll * FM_IDLE_FLOURISHES.length);
  return FM_IDLE_FLOURISHES[Math.min(FM_IDLE_FLOURISHES.length - 1, Math.max(0, n))];
}

/**
 * Clip to preload while `playing` runs.
 * Desired activity loops. Rest returns to idle, then a flourish every
 * `budget` idle plays.
 */
export function nextFmClip(input: {
  playing: FmAvatarClip;
  desired: FmAvatarClip;
  idleLoops: number;
  budget: number;
  flourish: FmIdleFlourish;
}): FmAvatarClip {
  if (input.desired !== "idle") return input.desired;
  if (input.playing !== "idle") return "idle";
  if (input.idleLoops + 1 >= input.budget) return input.flourish;
  return "idle";
}

/** Idle-loop counter after `playing` ends and `next` starts. */
export function nextFmIdleLoops(
  playing: FmAvatarClip,
  next: FmAvatarClip,
  idleLoops: number,
): number {
  if (playing === "idle" && next === "idle") return idleLoops + 1;
  if (next === "idle" || playing === "idle") return 0;
  return idleLoops;
}
