import { useEffect, useState } from "react";

export function SplashScreen() {
  const [phase, setPhase] = useState<"solid" | "fading" | "gone">("solid");

  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase("fading"), 700);
    const doneTimer = setTimeout(() => setPhase("gone"), 1000);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "#07090f",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: phase === "fading" ? 0 : 1,
        transition: phase === "fading" ? "opacity 300ms ease-out" : "none",
        pointerEvents: phase === "fading" ? "none" : "all",
      }}
    >
      <img
        src="/milon-centaur.png"
        alt=""
        style={{
          height: "clamp(140px, 22vw, 220px)",
          width: "auto",
          userSelect: "none",
        }}
      />
    </div>
  );
}
