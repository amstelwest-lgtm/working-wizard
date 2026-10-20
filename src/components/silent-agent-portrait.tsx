/**
 * Silent agent portrait. Poster first, then a muted idle loop.
 * Same clips as the landing faces. No audio.
 */
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import {
  avatarPoster,
  fmClipSources,
  type AvatarFace,
  type FmAvatarClip,
} from "@/lib/fm-avatar-state";

export function SilentAgentPortrait({
  face,
  label,
  large,
  clip = "idle",
}: {
  face: AvatarFace;
  label: string;
  large?: boolean;
  /** Approved mood clip. Always muted. Idle while listening, thinking while a reply is in flight. */
  clip?: Extract<FmAvatarClip, "idle" | "thinking" | "waiting">;
}) {
  const reduced = usePrefersReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduced) return;
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    const onPlaying = () => setLive(true);
    video.addEventListener("playing", onPlaying);
    const start = () => {
      void video.play().catch(() => {
        /* Poster stays when autoplay is refused. */
      });
    };
    if (video.readyState >= 2) start();
    else video.addEventListener("canplay", start, { once: true });
    return () => video.removeEventListener("playing", onPlaying);
  }, [reduced, clip]);

  const poster = avatarPoster(face);
  const sources = fmClipSources(clip, face);
  return (
    <div className={large ? "talk-portrait talk-portrait-lg" : "talk-portrait"}>
      <img src={poster.webp} alt="" width={512} height={512} />
      {!reduced ? (
        <video
          key={clip}
          ref={videoRef}
          className={live ? "is-live" : undefined}
          muted
          playsInline
          loop
          autoPlay
          preload="auto"
          poster={poster.webp}
          width={512}
          height={512}
          aria-label={`${label}, listening`}
        >
          <source src={sources.webm} type="video/webm" />
          <source src={sources.mp4} type="video/mp4" />
        </video>
      ) : null}
    </div>
  );
}
