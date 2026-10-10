import type { AgentKey } from "@/lib/milon-team-feed";

type Rhythm = {
  breathe: string;
  breatheDelay: string;
  drift: string;
  driftDelay: string;
  driftX: string;
  driftY: string;
  micro: string;
  microDelay: string;
  blink: string;
  blinkDelay: string;
  glance: string;
  glanceDelay: string;
  orbit: string;
  shimmer: string;
};

/** Different clocks so the three agents never inhale together. */
export function avatarRhythm(agent: AgentKey): Rhythm {
  if (agent === "financial_manager") {
    return {
      breathe: "4.6s",
      breatheDelay: "-1.2s",
      drift: "9.4s",
      driftDelay: "-3.1s",
      driftX: "3px",
      driftY: "-4px",
      micro: "11s",
      microDelay: "-2s",
      blink: "6.4s",
      blinkDelay: "-0.4s",
      glance: "8.2s",
      glanceDelay: "-1.6s",
      orbit: "18s",
      shimmer: "5.2s",
    };
  }
  if (agent === "analyst") {
    return {
      breathe: "5.5s",
      breatheDelay: "-2.8s",
      drift: "7.8s",
      driftDelay: "-0.6s",
      driftX: "-3px",
      driftY: "3px",
      micro: "13s",
      microDelay: "-6.2s",
      blink: "5.1s",
      blinkDelay: "-2.1s",
      glance: "9.4s",
      glanceDelay: "-4.4s",
      orbit: "22s",
      shimmer: "4.4s",
    };
  }
  return {
    breathe: "4.2s",
    breatheDelay: "-0.35s",
    drift: "11.2s",
    driftDelay: "-4.5s",
    driftX: "2px",
    driftY: "-3px",
    micro: "10s",
    microDelay: "-1.1s",
    blink: "7.2s",
    blinkDelay: "-3.3s",
    glance: "7.6s",
    glanceDelay: "-2.7s",
    orbit: "16s",
    shimmer: "6.1s",
  };
}
