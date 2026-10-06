/**
 * Landing diagnostic. Loaded when the quiz nears the viewport or a persona
 * card is chosen — not on first paint.
 */
import type { DraftMarket } from "@/lib/market";

type QuizStep = { q: string; hint: string; opts: string[][]; key: string; reward: string };

type QuizApi = {
  start: (role: string) => void;
  rebind: () => void;
};

let api: QuizApi | null = null;

export function resetLandingQuiz() {
  api = null;
  const w = window as unknown as Record<string, unknown>;
  delete w.__mq_start;
  delete w.__mq_pick;
  delete w.__mq_plan;
}

export function mountLandingQuiz(startRole?: string) {
  if (!api) api = installLandingQuiz();
  else api.rebind();
  if (startRole) api.start(startRole);
}

function installLandingQuiz(): QuizApi {
  const QUIZ: Record<string, QuizStep[]> = {
    owner: [
      {
        q: "What does your business do?",
        hint: "This places your first planet.",
        opts: [
          ["🛍", "Retail / E-commerce"],
          ["🔧", "Services"],
          ["🏗", "Construction"],
          ["🍽", "Hospitality"],
          ["🏭", "Manufacturing"],
          ["🚚", "Transport / Logistics"],
        ],
        key: "industry",
        reward: "✦ Industry mapped — your sun just ignited.",
      },
      {
        q: "How do customers pay you?",
        hint: "This shapes your cash orbit.",
        opts: [
          ["⚡", "Upfront / on the spot"],
          ["📅", "On account — 30+ days"],
          ["🔁", "Monthly retainers"],
          ["🧩", "A mix of everything"],
        ],
        key: "cashcycle",
        reward: "✦ Cash cycle charted — second planet in orbit.",
      },
      {
        q: "What keeps you up at night?",
        hint: "Be honest. We've heard it all.",
        opts: [
          ["💧", "Cash runs dry before month-end"],
          ["❓", "I don't know if I'm actually profitable"],
          ["⛓", "Debt is eating my margins"],
          ["🐢", "Customers pay me late"],
        ],
        key: "pain",
        reward: "✦ Pain point locked. Now we can aim.",
      },
      {
        q: "Roughly, your annual turnover?",
        hint: "This sets your peer group.",
        opts: [
          ["🌑", "Under R1m"],
          ["🌓", "R1m – R5m"],
          ["🌔", "R5m – R20m"],
          ["🌕", "R20m+"],
        ],
        key: "size",
        reward: "✦ Constellation complete.",
      },
    ],
    accountant: [
      {
        q: "What does your practice mostly do today?",
        hint: "This places your first star.",
        opts: [
          ["📋", "Compliance & tax"],
          ["📊", "Bookkeeping & payroll"],
          ["💼", "Some advisory already"],
          ["🚀", "Full CFO services"],
        ],
        key: "industry",
        reward: "✦ Practice profile started.",
      },
      {
        q: "How many SME clients do you serve?",
        hint: "This sizes your constellation.",
        opts: [
          ["✦", "1 – 10"],
          ["✦✦", "11 – 50"],
          ["✦✦✦", "51 – 150"],
          ["🌌", "150+"],
        ],
        key: "cashcycle",
        reward: "✦ Client universe mapped.",
      },
      {
        q: "What's your biggest frustration?",
        hint: "The thing that steals your margin.",
        opts: [
          ["⏳", "Clients only call in a crisis"],
          ["💸", "Can't charge for the advice I give"],
          ["🗂", "Data arrives late and messy"],
          ["📉", "Compliance fees keep shrinking"],
        ],
        key: "pain",
        reward: "✦ Pain point locked. This is fixable.",
      },
      {
        q: "What would change your practice most?",
        hint: "Your north star.",
        opts: [
          ["💰", "Recurring advisory revenue"],
          ["🛰", "Live oversight of every client"],
          ["🏷", "Reports with my brand on them"],
          ["🤝", "Deeper client relationships"],
        ],
        key: "size",
        reward: "✦ Constellation complete.",
      },
    ],
  };
  const REFLECT: Record<string, Record<string, string[]>> = {
    owner: {
      "💧": [
        "cash flow",
        "Cash is leaving faster than it arrives. <b>MILŌN's 13-week cash forecast shows where it is heading — and the accountant-reviewed actions that can change the picture.</b>",
      ],
      "❓": [
        "profit clarity",
        "You have the numbers, but not a finance function to interpret them. <b>MILŌN turns those figures into one health score, 19 ratios with the workings shown, and a clear view of what is driving profitability.</b>",
      ],
      "⛓": [
        "debt pressure",
        "Financing is creating pressure you can feel but not always name. <b>MILŌN scores how the business is funded — debt, interest cover, gearing and solvency — so the next move is specific.</b>",
      ],
      "🐢": [
        "slow payers",
        "Late payers are using you as a free bank. <b>MILŌN shows cash conversion, DSO and DPO, then turns the analysis into recommended actions your accountant can review and assign.</b>",
      ],
    },
    accountant: {
      "⏳": [
        "crisis-only clients",
        "Clients come to you after the damage is done. <b>MILŌN gives your firm an AI-powered finance function to run across clients — analysis, recommendations, and tracked actions in one workspace.</b>",
      ],
      "💸": [
        "unbilled advice",
        "Your clients already depend on you for their financial information. <b>MILŌN gives your firm a structured way to turn that information into ongoing financial analysis, recommendations, and action.</b>",
      ],
      "🗂": [
        "messy data",
        "Advice is only as good as the figures in front of you. <b>Upload the P&amp;L, balance sheet, or bank statement you already have — MILŌN prepares the analysis, and you review and sign off.</b>",
      ],
      "📉": [
        "fee compression",
        "Compliance work is not the same as a finance function. <b>MILŌN lets you give more clients access to that capability without building every analysis from scratch — you stay in control of the advice.</b>",
      ],
    },
  };
  let qRole = "owner";
  let step = 0;
  let answers: Record<string, { em: string; label: string }> = {};

  function startQuiz(r: string) {
    const raw = (window as unknown as { __milonDraftMarket?: DraftMarket }).__milonDraftMarket;
    const draft: DraftMarket =
      raw?.country === "ZA"
        ? raw
        : raw?.country === "US"
          ? raw
          : { country: "US" as const, regionCode: null };
    qRole = r;
    step = 0;
    answers = {};
    document.body.classList.remove("persona-owner", "persona-accountant");
    document.body.classList.add("persona-" + r);
    document.body.classList.toggle("market-us", draft.country === "US");
    const ownerQuiz = QUIZ.owner;
    const sizeQ = ownerQuiz.find((s) => s.key === "size");
    if (sizeQ) {
      if (draft.country === "US") {
        sizeQ.q = "Roughly, your annual revenue?";
        sizeQ.opts = [
          ["🌑", "Under $1m"],
          ["🌓", "$1m – $5m"],
          ["🌔", "$5m – $20m"],
          ["🌕", "$20m+"],
        ];
      } else {
        sizeQ.q = "Roughly, your annual turnover?";
        sizeQ.opts = [
          ["🌑", "Under R1m"],
          ["🌓", "R1m – R5m"],
          ["🌔", "R5m – R20m"],
          ["🌕", "R20m+"],
        ];
      }
    }
    const quiz = document.getElementById("quiz");
    if (quiz) {
      quiz.classList.add("active");
      quiz.scrollIntoView({ behavior: "smooth" });
    }
    renderStep();
  }
  function renderStep() {
    const steps = QUIZ[qRole];
    const holder = document.getElementById("qsteps");
    const qbar = document.getElementById("qbar");
    if (qbar) qbar.style.width = (step / steps.length) * 100 + "%";
    if (step >= steps.length) {
      renderResult();
      return;
    }
    const s = steps[step];
    if (holder)
      holder.innerHTML = `<div class="q-step on">
        <h3>${s.q}</h3>
        <p class="hint">${s.hint} <span style="color:var(--gold-ink)">Question ${step + 1} of ${steps.length}</span></p>
        <div class="opt-grid">${s.opts.map((o) => `<button class="opt" onclick="window.__mq_pick('${s.key}','${o[0]}','${o[1].replace(/'/g, "\\'")}',this)"><span class="em">${o[0]}</span>${o[1]}</button>`).join("")}</div>
      </div>`;
    const qreward = document.getElementById("qreward");
    if (qreward) qreward.textContent = "";
  }
  function pick(key: string, em: string, label: string, el: Element) {
    document.querySelectorAll(".opt").forEach((b) => b.classList.remove("picked"));
    el.classList.add("picked");
    answers[key] = { em, label };
    const qreward = document.getElementById("qreward");
    if (qreward) qreward.textContent = QUIZ[qRole][step].reward;
    setTimeout(() => {
      step++;
      renderStep();
    }, 850);
  }
  function renderResult() {
    const qbar = document.getElementById("qbar");
    if (qbar) qbar.style.width = "100%";
    const a = answers;
    const r = REFLECT[qRole][a.pain?.em] || Object.values(REFLECT[qRole])[0];
    const lines =
      qRole === "owner"
        ? `<p>Industry: <b>${a.industry?.label}</b></p><p>Cash cycle: <b>${a.cashcycle?.label}</b></p><p>Size band: <b>${a.size?.label}</b></p>`
        : `<p>Practice focus: <b>${a.industry?.label}</b></p><p>Client base: <b>${a.cashcycle?.label}</b></p><p>North star: <b>${a.size?.label}</b></p>`;
    const cta =
      qRole === "accountant"
        ? `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px">
          <button class="btn btn-gold" type="button" onclick="window.__mq_firmSignup()">Create firm account ✦</button>
          <a class="btn btn-ghost" href="#pricing">See firm pricing</a>
          <button class="btn btn-ghost" onclick="window.__mq_start('${qRole}')">Redo questions</button>
        </div>`
        : `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px">
          <a class="btn btn-gold" href="#register">Unlock my full diagnostic ✦</a>
          <button class="btn btn-ghost" onclick="window.__mq_start('${qRole}')">Redo questions</button>
        </div>`;
    const hint =
      qRole === "accountant"
        ? "Firm bands and a firm account are on this page — no extra quiz required."
        : "Your health score, cash forecast, and recommended next actions are one step away.";
    const holder = document.getElementById("qsteps");
    if (holder)
      holder.innerHTML = `<div class="q-step on">
        <p class="eyebrow">Your business, sketched</p>
        <h3>Here's what we see.</h3>
        <div class="mini-biz">
          <div class="mini-orrery">
            <div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div>
            <div class="core"></div>
            <div class="dot" style="top:6%;left:48%"></div>
            <div class="dot" style="top:42%;left:84%"></div>
            <div class="dot" style="top:74%;left:14%"></div>
          </div>
          <div class="profile-lines">${lines}<p>Biggest worry: <b>${a.pain?.label}</b></p></div>
        </div>
        <div class="reflect"><span class="serif gold-text">"${a.pain?.label}."</span><br>${r[1]}</div>
        <p class="hint">${hint}</p>
        ${cta}
      </div>`;
    const qreward = document.getElementById("qreward");
    if (qreward) qreward.textContent = "";
  }
  function pickPlan(p: string) {
    const sel = document.getElementById("regPlan") as HTMLSelectElement | null;
    if (sel)
      [...sel.options].forEach((o) => {
        if (o.value.startsWith(p)) sel.value = o.value;
      });
  }

  function rebind() {
    const w = window as unknown as Record<string, unknown>;
    w.__mq_start = startQuiz;
    w.__mq_pick = pick;
    w.__mq_plan = pickPlan;
  }
  rebind();
  return { start: startQuiz, rebind };
}
