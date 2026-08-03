import { createContext, useContext, useState, type ReactNode } from "react";

type ViewMode = "simplified" | "complex";

type ViewModeCtx = {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
};

const Ctx = createContext<ViewModeCtx>({
  viewMode: "simplified",
  setViewMode: () => {},
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useState<ViewMode>("simplified");
  return (
    <Ctx.Provider value={{ viewMode, setViewMode }}>
      {children}
    </Ctx.Provider>
  );
}

export const useViewMode = () => useContext(Ctx);
