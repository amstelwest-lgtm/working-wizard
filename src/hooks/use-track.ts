import { useAnalytics } from "@/contexts/analytics";

export function useTrack() {
  return useAnalytics().track;
}
