import { assertKeychainAvailable, clearState, saveState, type StoredState } from "./keychain.ts";
import { pairDevice } from "./api.ts";
import { runWatcher } from "./agent.ts";

function parseFolders(values: string[]): Array<{ watchPath: string; folderLabel: string }> {
  return values.map((entry) => {
    const split = entry.lastIndexOf("=");
    if (split < 1) throw new Error(`Folder must be /path=label, got ${entry}`);
    return {
      watchPath: entry.slice(0, split),
      folderLabel: entry.slice(split + 1),
    };
  });
}

async function cmdPair(args: string[]) {
  const api = args.find((a) => a.startsWith("--api="))?.slice(6);
  const code = args.find((a) => a.startsWith("--code="))?.slice(7);
  const label = args.find((a) => a.startsWith("--name="))?.slice(7) ?? "Practice PC";
  const folderArgs = args.filter((a) => a.startsWith("--folders=")).map((a) => a.slice(10));
  if (!api || !code || folderArgs.length < 1) {
    throw new Error("pair requires --api= --code= and at least one --folders=/path=label");
  }
  await assertKeychainAvailable();
  const body = (await pairDevice(api, code, label)) as {
    ok?: boolean;
    accessToken?: string;
    refreshToken?: string;
    folderMaps?: Array<{ folderLabel: string; clientId: string }>;
    apiBase?: string;
  };
  if (!body.ok || !body.accessToken || !body.refreshToken) {
    throw new Error("Pairing failed");
  }
  const maps = parseFolders(folderArgs);
  const state: StoredState = {
    apiBase: body.apiBase ?? api,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    folderMaps: maps,
    seenHashes: {},
  };
  await saveState(state);
  console.log("Paired. Run: milon-desktop-sync watch");
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help") {
    console.log("Commands: pair | watch | disconnect | uninstall");
    process.exit(0);
  }
  if (command === "pair") {
    await cmdPair(rest);
    return;
  }
  if (command === "watch") {
    const stop = await runWatcher((status) => {
      if (status === "disconnected") console.log("Disconnected");
    });
    process.on("SIGINT", () => {
      stop();
      process.exit(0);
    });
    console.log("Watching…");
    return;
  }
  if (command === "disconnect" || command === "uninstall") {
    await clearState();
    console.log(command === "uninstall" ? "Local state cleared." : "Disconnected locally.");
    return;
  }
  throw new Error(`Unknown command ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});