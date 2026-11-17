/**
 * Action descriptions must not leak a projection payload.
 * Run: pnpm test:action-description-guard
 */
import { presentActionWhy } from "../src/lib/milon-team-activity.ts";
import { stripMilonProjection } from "../src/lib/milon-projection.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const leaked =
  '","pillar":"cash","impactLabel":"+R24k cash","frozenAt":"2026-09-13T00:00:00.000Z","driver":{"from":"R 162","to":"R 40"}@@/milon-projection@@';
const description = `Collect cash sooner. ${leaked}`;

function clean(text: string) {
  assert(!text.includes("{"), text);
  assert(!text.includes("@@"), text);
  for (const key of ["pillar", "impactLabel", "frozenAt", "driver"]) {
    assert(!text.includes(key), `${key} leaked: ${text}`);
  }
}

clean(stripMilonProjection(description));
clean(presentActionWhy(description));
assert(presentActionWhy(description).includes("Collect cash sooner"), presentActionWhy(description));
assert(presentActionWhy(leaked) === "", presentActionWhy(leaked));

const intact = 'Chase the overdue invoice @@milon-projection@@{"cash":44880} before Friday.';
assert(
  stripMilonProjection(intact) === "Chase the overdue invoice before Friday.",
  stripMilonProjection(intact),
);

console.log("action description guard ok");
