import { useState } from "react";

type Props = {
  videoId: string;
  title: string;
  accessibleName: string;
};

function preconnectYouTube() {
  if (typeof document === "undefined") return;
  if (document.querySelector("link[data-yt-preconnect]")) return;
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = "https://www.youtube-nocookie.com";
  link.crossOrigin = "anonymous";
  link.dataset.ytPreconnect = "1";
  document.head.appendChild(link);
}

/**
 * Click-to-load YouTube facade. No youtube.com request until the button is
 * activated. Preconnect runs on pointerover only.
 */
export function LiteYouTube({ videoId, title, accessibleName }: Props) {
  const [active, setActive] = useState(false);
  const poster = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const fallback = poster;
  const srcSet = [
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg 480w`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg 640w`,
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg 1280w`,
  ].join(", ");

  if (active) {
    return (
      <div className="yt-frame">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
          title={`${title} — Milōn teaser`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="yt-facade"
      aria-label={accessibleName}
      onPointerOver={preconnectYouTube}
      onClick={() => setActive(true)}
    >
      {/* Phone slot stays on hqdefault (480w). 92vw at 412px × 1.75dpr
          crosses 640w and downloads maxresdefault; 81vw still selects the
          4:3 sddefault frame (~32KB, ~20KB waste against the 16:9 crop). */}
      <img
        src={poster}
        srcSet={srcSet}
        sizes="(max-width: 767px) 260px, 560px"
        alt=""
        width={1280}
        height={720}
        loading="lazy"
        decoding="async"
        style={{ aspectRatio: "16 / 9", objectFit: "cover" }}
        onError={(event) => {
          const img = event.currentTarget;
          if (img.dataset.ytFallback === "1") return;
          img.dataset.ytFallback = "1";
          img.srcset = "";
          img.src = fallback;
        }}
      />
      <span className="yt-play" aria-hidden="true" />
    </button>
  );
}
