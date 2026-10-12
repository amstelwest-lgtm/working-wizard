/**
 * Silent Financial Manager clips. Two stacked videos crossfade at a
 * neutral frame (the clip end, or the opening frame if we have not left it).
 * WebM first, MP4 if that cannot play. Nothing loads until the face is near
 * the viewport. Reduced motion keeps the poster.
 */
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import {
  FM_CROSSFADE_MS,
  FM_POSTER,
  fmClipSources,
  fmIdleBudget,
  fmIdleFlourish,
  nextFmClip,
  nextFmIdleLoops,
  type FmAvatarClip,
  type FmIdleFlourish,
} from "@/lib/fm-avatar-state";

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

function loadClip(video: HTMLVideoElement, clip: FmAvatarClip) {
  if (video.dataset.clip === clip && video.dataset.ready === "1") return;
  const sources = fmClipSources(clip);
  video.dataset.clip = clip;
  video.dataset.ready = "0";
  video.dataset.fallback = "";
  video.preload = "auto";
  silence(video);
  while (video.firstChild) video.removeChild(video.firstChild);
  video.removeAttribute("src");
  const webm = document.createElement("source");
  webm.src = sources.webm;
  webm.type = "video/webm";
  const mp4 = document.createElement("source");
  mp4.src = sources.mp4;
  mp4.type = "video/mp4";
  video.append(webm, mp4);
  video.load();
}

function forceMp4(video: HTMLVideoElement) {
  const clip = video.dataset.clip;
  if (!clip || video.dataset.fallback === "mp4") return;
  video.dataset.fallback = "mp4";
  video.dataset.ready = "0";
  while (video.firstChild) video.removeChild(video.firstChild);
  video.src = fmClipSources(clip as FmAvatarClip).mp4;
  video.load();
}

function whenReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.dataset.ready === "1") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.dataset.ready = "1";
      cleanup();
      resolve();
    };
    const fail = () => {
      forceMp4(video);
    };
    const timer = window.setTimeout(done, 2500);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", done);
      video.removeEventListener("canplay", done);
      video.removeEventListener("error", fail);
    };
    video.addEventListener("loadeddata", done);
    video.addEventListener("canplay", done);
    video.addEventListener("error", fail);
  });
}

export function FmVideoAvatar({ clip }: { clip: FmAvatarClip }) {
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLSpanElement>(null);
  const firstRef = useRef<HTMLVideoElement>(null);
  const secondRef = useRef<HTMLVideoElement>(null);
  const clipRef = useRef(clip);
  const retargetRef = useRef<(next: FmAvatarClip) => void>(() => undefined);
  const [near, setNear] = useState(false);
  const [slot, setSlot] = useState<0 | 1 | null>(null);
  const [shown, setShown] = useState<string>("poster");

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
    let active = 0;
    let started = false;
    let playing: FmAvatarClip = clipRef.current;
    let desired: FmAvatarClip = clipRef.current;
    let idleLoops = 0;
    let budget = fmIdleBudget(Math.random());
    let flourish: FmIdleFlourish = fmIdleFlourish(Math.random());
    let queued: FmAvatarClip = desired;
    let fade = 0;

    for (const video of videos) {
      if (!video) continue;
      silence(video);
      video.preload = "none";
      video.addEventListener("error", () => forceMp4(video));
    }

    function plan(from: FmAvatarClip): FmAvatarClip {
      return nextFmClip({ playing: from, desired, idleLoops, budget, flourish });
    }

    function preload(nextSlot: 0 | 1, name: FmAvatarClip) {
      const video = videos[nextSlot];
      if (!video) return;
      queued = name;
      video.preload = "auto";
      loadClip(video, name);
    }

    async function show(nextSlot: 0 | 1, name: FmAvatarClip) {
      const token = ++generation;
      const incoming = videos[nextSlot];
      const outgoing = videos[1 - nextSlot];
      if (!incoming || !outgoing || cancelled) return;
      incoming.preload = "auto";
      loadClip(incoming, name);
      await whenReady(incoming);
      if (cancelled || token !== generation) return;
      silence(incoming);
      try {
        incoming.currentTime = 0;
      } catch {
        /* The element can reject a seek before metadata. Play still starts at 0. */
      }
      try {
        await incoming.play();
      } catch {
        /* Muted autoplay can still be refused. The poster stays up. */
        return;
      }
      if (cancelled || token !== generation) return;
      const previous = playing;
      active = nextSlot;
      playing = name;
      if (started) idleLoops = nextFmIdleLoops(previous, name, idleLoops);
      started = true;
      if ((name === "calm" || name === "curious" || name === "pleased") && name !== desired) {
        flourish = fmIdleFlourish(Math.random());
        budget = fmIdleBudget(Math.random());
      }
      setSlot(nextSlot);
      setShown(name);
      window.clearTimeout(fade);
      fade = window.setTimeout(() => {
        outgoing.pause();
      }, FM_CROSSFADE_MS);
      preload((1 - nextSlot) as 0 | 1, plan(name));
    }

    function onEnded(event: Event) {
      if (cancelled) return;
      if (event.currentTarget !== videos[active]) return;
      const next = queued;
      void show((1 - active) as 0 | 1, next);
    }

    function retarget(next: FmAvatarClip) {
      desired = next;
      const upcoming = plan(playing);
      const idleVideo = videos[1 - active];
      if (idleVideo && upcoming !== queued) preload((1 - active) as 0 | 1, upcoming);
      const activeVideo = videos[active];
      if (!activeVideo || upcoming === playing) return;
      const atStart = activeVideo.currentTime < 0.15;
      const atEnd =
        activeVideo.ended ||
        (activeVideo.duration > 0 && activeVideo.currentTime >= activeVideo.duration - 0.15);
      if (atStart || atEnd) void show((1 - active) as 0 | 1, upcoming);
    }

    retargetRef.current = retarget;
    videos[0].addEventListener("ended", onEnded);
    videos[1].addEventListener("ended", onEnded);
    void show(0, desired);

    return () => {
      cancelled = true;
      retargetRef.current = () => undefined;
      window.clearTimeout(fade);
      videos[0]?.removeEventListener("ended", onEnded);
      videos[1]?.removeEventListener("ended", onEnded);
      videos[0]?.pause();
      videos[1]?.pause();
    };
  }, [near, reduced]);

  useEffect(() => {
    retargetRef.current(clip);
  }, [clip]);

  const play = !reduced && near;

  return (
    <span
      ref={rootRef}
      className="owner-fm-face"
      data-fm-clip={clip}
      data-fm-shown={shown}
      aria-hidden="true"
    >
      <picture className="owner-fm-poster">
        <source srcSet={FM_POSTER.webp} type="image/webp" />
        <img src={FM_POSTER.jpg} alt="" draggable={false} />
      </picture>
      {play ? (
        <>
          <video
            ref={firstRef}
            className={slot === 0 ? "is-on" : undefined}
            muted
            playsInline
            preload="none"
            poster={FM_POSTER.webp}
            tabIndex={-1}
            disablePictureInPicture
          />
          <video
            ref={secondRef}
            className={slot === 1 ? "is-on" : undefined}
            muted
            playsInline
            preload="none"
            poster={FM_POSTER.webp}
            tabIndex={-1}
            disablePictureInPicture
          />
        </>
      ) : null}
    </span>
  );
}
