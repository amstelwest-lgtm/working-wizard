/**
 * An owner whose accountant is on Milōn sees the included plan and no checkout CTA.
 * Run: pnpm test:owner-included-subscribe
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerPlan, OwnerSettings } from "../src/components/owner-door/owner-pages.tsx";
import { ownerPlanLine } from "../src/lib/owner-plan.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const includedLine = ownerPlanLine({
  visitor: "us",
  accountantOnMilon: true,
  firmName: null,
});
assert(
  includedLine === "Owner plan · included — Your accountant is on Milōn",
  `included line, saw ${includedLine}`,
);

function plan(accountantOnMilon: boolean) {
  return renderToStaticMarkup(
    createElement(OwnerPlan, {
      visitor: "us",
      accountantOnMilon,
      firmName: accountantOnMilon ? "Northline" : null,
      billing: { kind: "subscribe" },
      onSubscribe: () => undefined,
      onInvite: () => undefined,
    }) as ReactElement,
  );
}

function settings(accountantOnMilon: boolean) {
  return renderToStaticMarkup(
    createElement(OwnerSettings, {
      visitor: "us",
      accountantOnMilon,
      firmName: accountantOnMilon ? "Northline" : null,
      onProfile: () => undefined,
      onQuickBooks: () => undefined,
      onXero: () => undefined,
      onBack: () => undefined,
      billing: { kind: "subscribe" },
      onSubscribe: () => undefined,
    }) as ReactElement,
  );
}

const coveredPlan = plan(true);
const coveredSettings = settings(true);
const coveredLine = ownerPlanLine({
  visitor: "us",
  accountantOnMilon: true,
  firmName: "Northline",
});

assert(textOf(coveredPlan).includes(coveredLine), "Plan & billing names the included accountant plan");
assert(!coveredPlan.includes(">Subscribe<"), "Plan & billing hides Subscribe when the accountant covers the plan");
assert(!coveredPlan.includes(">Manage billing<"), "Plan & billing hides Manage billing when the plan is included");
assert(coveredPlan.includes('data-owner-subscribe="covered"'), "the included plan has no checkout action");
assert(!coveredPlan.includes('data-owner-subscribe="subscribe"'), "the included plan does not keep the subscribe view");

assert(textOf(coveredSettings).includes(coveredLine), "Settings plan names the included accountant plan");
assert(!coveredSettings.includes(">Subscribe<"), "Settings hides Subscribe when the accountant covers the plan");
assert(!coveredSettings.includes(">Manage billing<"), "Settings hides the billing portal CTA when the plan is included");

const paying = plan(false);
assert(paying.includes(">Subscribe<"), "an owner without an accountant still sees Subscribe");
assert(paying.includes('data-owner-subscribe="subscribe"'), "an unpaid owner stays on the subscribe view");

console.log("owner-included-subscribe: ok");
