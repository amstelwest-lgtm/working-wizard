/**
 * The three Milōn agents as people, layered over the hero finance report.
 * Each face paints its poster first; the silent idle loop only loads once
 * the card is near the viewport, then fades in over the poster. The clips
 * are muted and have no speaking motion. Reduced motion keeps the poster.
 */
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { avatarPoster, fmClipSources, type AvatarFace } from "@/lib/fm-avatar-state";

const HERO_AGENTS: ReadonlyArray<{ agent: AvatarFace; name: string }> = [
  { agent: "financial_manager", name: "Milōn Financial Manager" },
  { agent: "analyst", name: "Milōn Analyst" },
  { agent: "advisor", name: "Milōn Advisor" },
];

function HeroAgentFace({ agent }: { agent: AvatarFace }) {
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLSpanElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [near, setNear] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (reduced || !near) return;
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    const show = () => setLive(true);
    video.addEventListener("playing", show);
    const play = () => {
      void video.play().catch(() => {
        /* Autoplay refused: the poster stays. */
      });
    };
    // Keep the loop paused while it is scrolled away.
    const watcher = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible) play();
      else video.pause();
    });
    watcher.observe(video);
    return () => {
      video.removeEventListener("playing", show);
      watcher.disconnect();
      video.pause();
    };
  }, [reduced, near]);

  const poster = avatarPoster(agent);
  const sources = fmClipSources("idle", agent);
  return (
    <span ref={rootRef} className={`hero-agent-face${live ? " is-live" : ""}`} aria-hidden="true">
      <picture>
        <source srcSet={poster.webp} type="image/webp" />
        <img src={poster.jpg} alt="" width={512} height={512} draggable={false} />
      </picture>
      {!reduced && near ? (
        <video
          ref={videoRef}
          muted
          playsInline
          loop
          preload="none"
          tabIndex={-1}
          disablePictureInPicture
        >
          <source src={sources.webm} type="video/webm" />
          <source src={sources.mp4} type="video/mp4" />
        </video>
      ) : null}
    </span>
  );
}

export function HeroAgents() {
  return (
    <ul className="hero-agents" aria-label="Your Milōn finance team">
      {HERO_AGENTS.map(({ agent, name }) => (
        <li className="hero-agent" key={agent}>
          <HeroAgentFace agent={agent} />
          <span className="hero-agent-name">{name}</span>
        </li>
      ))}
    </ul>
  );
}
