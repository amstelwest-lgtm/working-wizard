/**
 * Silent character clips. Every face uses this player.
 * Two stacked videos crossfade at a neutral frame. The incoming clip stays
 * hidden until it is playing and a frame has been decoded, and the outgoing
 * clip stays up until then. The swap waits for the last frame of whatever
 * file is playing, so either clip length hands off
 * without a blank frame. WebM first, MP4 when the browser can play MP4 but
 * not WebM (Safari). Nothing loads until the face is near the viewport.
 * Reduced motion keeps the poster.
 */
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import {
  AVATAR_CLIP_FPS,
  FM_CROSSFADE_MS,
  avatarClipAtEnd,
  avatarPoster,
  fmClipSources,
  fmIdleBudget,
  fmIdleFlourish,
  nextFmClip,
  nextFmIdleLoops,
  type AvatarFace,
  type FmAvatarClip,
  type FmIdleFlourish,
} from "@/lib/fm-avatar-state";

type FramedVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
};

function silence(video: HTMLVideoElement) {
  video.muted = true;
  video.defaultMuted = true;
  try {
    video.volume = 0;
  } catch {
    /* Some engines reject volume before metadata. muted still holds. */
  }
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
}

/**
 * Safari has no WebM. Asking it to try WebM first can fire an error and
 * clear the element. Only skip WebM when MP4 is actually supported, so a
 * browser with neither codec stays on the source list.
 */
function webmUnsupported(): boolean {
  try {
    const probe = document.createElement("video");
    return probe.canPlayType("video/webm") === "" && probe.canPlayType("video/mp4") !== "";
  } catch {
    return false;
  }
}

/** Swap sources only on a clip that is not the one on screen. */
function loadHiddenClip(video: HTMLVideoElement, clip: FmAvatarClip, agent: AvatarFace) {
  if (video.dataset.clip === clip && video.dataset.agent === agent && video.dataset.ready === "1") {
    return;
  }
  const sources = fmClipSources(clip, agent);
  video.dataset.clip = clip;
  video.dataset.agent = agent;
  video.dataset.ready = "0";
  video.preload = "auto";
  silence(video);
  while (video.firstChild) video.removeChild(video.firstChild);
  video.removeAttribute("src");
  if (video.dataset.fallback === "mp4" || webmUnsupported()) {
    video.dataset.fallback = "mp4";
    video.src = sources.mp4;
  } else {
    video.dataset.fallback = "";
    const webm = document.createElement("source");
    webm.src = sources.webm;
    webm.type = "video/webm";
    const mp4 = document.createElement("source");
    mp4.src = sources.mp4;
    mp4.type = "video/mp4";
    video.append(webm, mp4);
  }
  video.load();
}

function forceMp4(video: HTMLVideoElement, agent: AvatarFace) {
  const clip = video.dataset.clip;
  if (!clip || video.dataset.fallback === "mp4") return;
  video.dataset.fallback = "mp4";
  video.dataset.ready = "0";
  while (video.firstChild) video.removeChild(video.firstChild);
  video.src = fmClipSources(clip as FmAvatarClip, agent).mp4;
  video.load();
}

/** Keep the last painted frame. Pausing before duration avoids a blank end. */
function holdLastFrame(video: HTMLVideoElement) {
  if (!video.paused) video.pause();
}

function whenReady(video: HTMLVideoElement, agent: AvatarFace): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.dataset.ready === "1") {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const done = () => {
      video.dataset.ready = "1";
      cleanup();
      resolve();
    };
    const fail = () => {
      if (video.dataset.fallback === "mp4") {
        cleanup();
        reject(new Error("fm-clip"));
        return;
      }
      forceMp4(video, agent);
    };
    const cleanup = () => {
      video.removeEventListener("loadeddata", done);
      video.removeEventListener("canplay", done);
      video.removeEventListener("error", fail);
    };
    video.addEventListener("loadeddata", done);
    video.addEventListener("canplay", done);
    video.addEventListener("error", fail);
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) done();
  });
}

function seekStart(video: HTMLVideoElement): Promise<void> {
  if (video.currentTime < 0.05) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    try {
      video.currentTime = 0;
    } catch {
      done();
    }
  });
}

/** A decoded frame, via requestVideoFrameCallback where the browser has it. */
function presentedFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const framed = video as FramedVideo;
    if (typeof framed.requestVideoFrameCallback === "function") {
      framed.requestVideoFrameCallback(() => resolve());
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Resolves once `playing` or `canplaythrough` has fired and a frame is decoded.
 * Listeners attach before play(), so a fast `playing` event is not missed.
 */
function waitToShow(video: HTMLVideoElement): { done: Promise<void>; cancel: () => void } {
  let cancel = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onSignal = () => {
      void presentedFrame(video).then(finish);
    };
    const onError = () => fail(new Error("fm-clip"));
    const reveal = window.setTimeout(finish, 400);
    const cleanup = () => {
      window.clearTimeout(reveal);
      video.removeEventListener("playing", onSignal);
      video.removeEventListener("canplaythrough", onSignal);
      video.removeEventListener("error", onError);
    };
    cancel = () => fail(new Error("cancelled"));
    video.addEventListener("playing", onSignal);
    video.addEventListener("canplaythrough", onSignal);
    video.addEventListener("error", onError);
    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) onSignal();
  });
  return { done, cancel };
}

export function FmVideoAvatar({ clip, agent }: { clip: FmAvatarClip; agent: AvatarFace }) {
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLSpanElement>(null);
  const firstRef = useRef<HTMLVideoElement>(null);
  const secondRef = useRef<HTMLVideoElement>(null);
  const clipRef = useRef(clip);
  const retargetRef = useRef<(next: FmAvatarClip) => void>(() => undefined);
  const [near, setNear] = useState(false);
  const [slot, setSlot] = useState<0 | 1 | null>(null);
  const [hold, setHold] = useState<0 | 1 | null>(null);
  const [shown, setShown] = useState<string>("poster");
  const [live, setLive] = useState(false);

  clipRef.current = clip;

  useEffect(() => {
    if (reduced) return;
    const node = rootRef.current;
    if (!node) return;
    const mark = () => setNear(true);
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.bottom > -120 && rect.top < window.innerHeight + 120) mark();
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) mark();
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (reduced || !near) return;
    const videos = [firstRef.current, secondRef.current];
    if (!videos[0] || !videos[1]) return;
    let cancelled = false;
    let generation = 0;
    let visibleSlot: 0 | 1 = 0;
    let revealed = false;
    let holding = false;
    let playing: FmAvatarClip = clipRef.current;
    let desired: FmAvatarClip = clipRef.current;
    let idleLoops = 0;
    let budget = agent === "tax_specialist" ? 1 : fmIdleBudget(Math.random());
    let flourish: FmIdleFlourish = fmIdleFlourish(Math.random());
    let queued: FmAvatarClip = desired;
    // tax-idle is almost a still, especially at pill size. Open on a moving flourish.
    let intro: FmAvatarClip | null =
      agent === "tax_specialist" && desired === "idle" ? flourish : null;
    let fade = 0;
    let endTimer = 0;
    let ending = false;
    let advanced = false;
    let tail = Promise.resolve();

    function enqueue(task: () => Promise<void> | void) {
      const run = tail.then(() => {
        if (cancelled) return;
        return task();
      });
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }

    for (const video of videos) {
      if (!video) continue;
      silence(video);
      video.preload = "none";
    }

    function plan(from: FmAvatarClip): FmAvatarClip {
      return nextFmClip({ playing: from, desired, idleLoops, budget, flourish });
    }

    async function prepare(nextSlot: 0 | 1, name: FmAvatarClip) {
      const video = videos[nextSlot];
      if (!video || cancelled) return;
      if (revealed && video === videos[visibleSlot]) return;
      if (
        video.dataset.clip !== name ||
        video.dataset.agent !== agent ||
        video.dataset.ready !== "1"
      ) {
        loadHiddenClip(video, name, agent);
        try {
          await whenReady(video, agent);
        } catch {
          return;
        }
      }
      if (cancelled) return;
      if (revealed && video === videos[visibleSlot]) return;
      if (video.currentTime >= 0.05) await seekStart(video);
    }

    async function show(nextSlot: 0 | 1) {
      const token = ++generation;
      const incoming = videos[nextSlot];
      const outgoing = videos[visibleSlot];
      if (!incoming || cancelled) return;
      if (revealed && incoming === outgoing) return;
      const opening = intro ?? desired;
      const name = revealed ? queued : opening;
      await prepare(nextSlot, name);
      if (cancelled || token !== generation) return;
      if (revealed && incoming === videos[visibleSlot]) return;
      const clipName = revealed ? queued : opening;
      if (!revealed) intro = null;
      if (incoming.dataset.clip !== clipName) {
        await prepare(nextSlot, clipName);
        if (cancelled || token !== generation) return;
      }
      silence(incoming);
      incoming.autoplay = true;
      incoming.loop = false;
      const waiter = waitToShow(incoming);
      try {
        await incoming.play();
      } catch {
        try {
          await whenReady(incoming, agent);
          await incoming.play();
        } catch {
          waiter.cancel();
          return;
        }
      }
      try {
        await waiter.done;
      } catch {
        return;
      }
      if (cancelled || token !== generation) {
        incoming.pause();
        return;
      }
      const previous = playing;
      const previousSlot = visibleSlot;
      visibleSlot = nextSlot;
      playing = clipName;
      if (revealed) idleLoops = nextFmIdleLoops(previous, clipName, idleLoops);
      revealed = true;
      if (
        (clipName === "calm" || clipName === "curious" || clipName === "pleased") &&
        clipName !== desired
      ) {
        flourish = fmIdleFlourish(Math.random());
        budget = agent === "tax_specialist" ? 1 : fmIdleBudget(Math.random());
      }
      holding = true;
      setHold(previousSlot === nextSlot ? null : previousSlot);
      setSlot(nextSlot);
      setShown(clipName);
      window.clearTimeout(fade);
      fade = window.setTimeout(() => {
        void enqueue(async () => {
          holding = false;
          if (outgoing && outgoing !== incoming) outgoing.pause();
          setHold(null);
          setLive(true);
          queued = plan(playing);
          await prepare((1 - nextSlot) as 0 | 1, queued);
        });
      }, FM_CROSSFADE_MS);
      advanced = false;
      watchEnd(incoming);
    }

    function advance() {
      if (cancelled || ending || !revealed || advanced) return;
      advanced = true;
      ending = true;
      const active = videos[visibleSlot];
      if (active) holdLastFrame(active);
      const nextSlot = (1 - visibleSlot) as 0 | 1;
      void enqueue(async () => {
        try {
          await show(nextSlot);
        } finally {
          ending = false;
        }
      });
    }

    function watchEnd(video: HTMLVideoElement) {
      window.clearTimeout(endTimer);
      const tick = () => {
        if (cancelled || video !== videos[visibleSlot]) return;
        if (ending) {
          endTimer = window.setTimeout(tick, 50);
          return;
        }
        if (avatarClipAtEnd(video.currentTime, video.duration)) {
          advance();
          return;
        }
        const frameMs = 1000 / AVATAR_CLIP_FPS;
        const remaining = Number.isFinite(video.duration)
          ? (video.duration - video.currentTime) * 1000 - frameMs
          : frameMs;
        endTimer = window.setTimeout(tick, Math.max(16, remaining));
      };
      const framed = video as FramedVideo;
      if (typeof framed.requestVideoFrameCallback === "function") {
        const onFrame = () => {
          if (cancelled || video !== videos[visibleSlot]) return;
          if (!ending && avatarClipAtEnd(video.currentTime, video.duration)) {
            advance();
            return;
          }
          framed.requestVideoFrameCallback?.(onFrame);
        };
        framed.requestVideoFrameCallback(onFrame);
      }
      tick();
    }

    function onEnded(event: Event) {
      if (cancelled) return;
      if (event.currentTarget !== videos[visibleSlot]) return;
      advance();
    }

    function retarget(next: FmAvatarClip) {
      desired = next;
      void enqueue(async () => {
        queued = plan(playing);
        if (!revealed || holding) return;
        await prepare((1 - visibleSlot) as 0 | 1, queued);
      });
    }

    retargetRef.current = retarget;
    videos[0].addEventListener("ended", onEnded);
    videos[1].addEventListener("ended", onEnded);
    void enqueue(() => show(0));

    return () => {
      cancelled = true;
      retargetRef.current = () => undefined;
      window.clearTimeout(fade);
      window.clearTimeout(endTimer);
      videos[0]?.removeEventListener("ended", onEnded);
      videos[1]?.removeEventListener("ended", onEnded);
      videos[0]?.pause();
      videos[1]?.pause();
    };
  }, [agent, near, reduced]);

  useEffect(() => {
    retargetRef.current(clip);
  }, [clip]);

  const play = !reduced && near;
  const poster = avatarPoster(agent);
  const clipClass = (index: 0 | 1) =>
    [slot === index ? "is-on" : "", hold === index ? "is-hold" : ""].filter(Boolean).join(" ") ||
    undefined;

  return (
    <span
      ref={rootRef}
      className={`owner-fm-face${live ? " is-live" : ""}`}
      data-fm-agent={agent}
      data-fm-clip={clip}
      data-fm-shown={shown}
      aria-hidden="true"
    >
      <picture className="owner-fm-poster">
        <source srcSet={poster.webp} type="image/webp" />
        <img src={poster.jpg} alt="" draggable={false} />
      </picture>
      {play ? (
        <>
          <video
            ref={firstRef}
            className={clipClass(0)}
            autoPlay
            muted
            playsInline
            preload="none"
            tabIndex={-1}
            disablePictureInPicture
          />
          <video
            ref={secondRef}
            className={clipClass(1)}
            autoPlay
            muted
            playsInline
            preload="none"
            tabIndex={-1}
            disablePictureInPicture
          />
        </>
      ) : null}
    </span>
  );
}
