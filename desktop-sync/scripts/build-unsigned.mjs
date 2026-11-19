import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

execSync("pnpm run build", { stdio: "inherit", cwd: new URL("..", import.meta.url).pathname });
mkdirSync(new URL("../dist", import.meta.url).pathname, { recursive: true });
writeFileSync(
  new URL("../dist/BUILD-UNSIGNED.txt", import.meta.url),
  "Unsigned dev build. See README for code signing env names.\n",
);
console.log("Unsigned build ready in desktop-sync/dist");