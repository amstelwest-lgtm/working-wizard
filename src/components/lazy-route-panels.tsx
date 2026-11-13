import { Suspense, type ComponentProps, type ComponentType } from "react";
import { ReservedFallback } from "@/components/reserved-fallback";
import { lazyPanel } from "@/components/lazy-panel";
import type { CashForecastPanel as CashForecastPanelType } from "@/components/cash-forecast";
import type { BudgetPanel as BudgetPanelType } from "@/components/budget/budget-panel";
import type { ReviewInputsDrawer as ReviewInputsDrawerType } from "@/components/review-inputs-drawer";
import type { WalkthroughWizard as WalkthroughWizardType } from "@/components/walkthrough-wizard";
import type { CheckoutAfterInsight as CheckoutAfterInsightType } from "@/components/checkout-after-insight";
import type { HealthScoreAnswer as HealthScoreAnswerType } from "@/components/health-score-answer";
import type { OwnerInsightFigures as OwnerInsightFiguresType } from "@/components/owner-insight-figures";
import type { OwnerBillingBridge as OwnerBillingBridgeType } from "@/components/owner-door/owner-billing-bridge";
import type { AdvisoryPackPanel as AdvisoryPackPanelType } from "@/components/advisory-pack-panel";
import type { CollectionsPanel as CollectionsPanelType } from "@/components/collections-panel";
import type { PayablesPanel as PayablesPanelType } from "@/components/payables-panel";
import type { StrategicMovesPanel as StrategicMovesPanelType } from "@/components/strategic-moves-panel";
import type { DataUpToDate as DataUpToDateType } from "@/components/data-up-to-date";
import type { ProfitWorkspace as ProfitWorkspaceType } from "@/components/profit/profit-workspace";
import type { DeliverableInputConfig as DeliverableInputConfigType } from "@/components/deliverable-input-config";
import type { PastPeriodUploadDialog as PastPeriodUploadDialogType } from "@/components/past-period-upload";
import type { TrialEndedPlanBlock as TrialEndedPlanBlockType } from "@/components/trial-ended-plan-block";

function load<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  label: string,
): ComponentType<P> {
  return lazyPanel(loader, label) as ComponentType<P>;
}

function held<P extends object>(Panel: ComponentType<P>, label: string, height: number) {
  return function HeldPanel(props: P) {
    return (
      <Suspense fallback={<ReservedFallback label={label} height={height} />}>
        <Panel {...props} />
      </Suspense>
    );
  };
}

type CashProps = NonNullable<ComponentProps<typeof CashForecastPanelType>>;
type BudgetProps = NonNullable<ComponentProps<typeof BudgetPanelType>>;
type ReviewProps = NonNullable<ComponentProps<typeof ReviewInputsDrawerType>>;
type WalkProps = NonNullable<ComponentProps<typeof WalkthroughWizardType>>;
type CheckoutProps = NonNullable<ComponentProps<typeof CheckoutAfterInsightType>>;
type HealthProps = NonNullable<ComponentProps<typeof HealthScoreAnswerType>>;
type InsightProps = NonNullable<ComponentProps<typeof OwnerInsightFiguresType>>;
type BillingProps = NonNullable<ComponentProps<typeof OwnerBillingBridgeType>>;
type PackProps = NonNullable<ComponentProps<typeof AdvisoryPackPanelType>>;
type CollectionsProps = NonNullable<ComponentProps<typeof CollectionsPanelType>>;
type PayablesProps = NonNullable<ComponentProps<typeof PayablesPanelType>>;
type MovesProps = NonNullable<ComponentProps<typeof StrategicMovesPanelType>>;
type FreshProps = NonNullable<ComponentProps<typeof DataUpToDateType>>;
type ProfitProps = NonNullable<ComponentProps<typeof ProfitWorkspaceType>>;
type InputsProps = NonNullable<ComponentProps<typeof DeliverableInputConfigType>>;
type PastProps = NonNullable<ComponentProps<typeof PastPeriodUploadDialogType>>;
type TrialProps = NonNullable<ComponentProps<typeof TrialEndedPlanBlockType>>;

export const LazyCashForecastPanel = held(
  load<CashProps>(
    () => import("@/components/cash-forecast").then((m) => ({ default: m.CashForecastPanel })),
    "Cash forecast",
  ),
  "Cash forecast",
  560,
);
export const LazyBudgetPanel = held(
  load<BudgetProps>(
    () => import("@/components/budget/budget-panel").then((m) => ({ default: m.BudgetPanel })),
    "Budget",
  ),
  "Budget",
  560,
);
export const LazyReviewInputsDrawer = held(
  load<ReviewProps>(
    () => import("@/components/review-inputs-drawer").then((m) => ({ default: m.ReviewInputsDrawer })),
    "Review inputs",
  ),
  "Review inputs",
  52,
);
export const LazyWalkthroughWizard = held(
  load<WalkProps>(
    () => import("@/components/walkthrough-wizard").then((m) => ({ default: m.WalkthroughWizard })),
    "Walkthrough",
  ),
  "Walkthrough",
  0,
);
export const LazyCheckoutAfterInsight = held(
  load<CheckoutProps>(
    () => import("@/components/checkout-after-insight").then((m) => ({ default: m.CheckoutAfterInsight })),
    "Billing",
  ),
  "Billing",
  0,
);
export const LazyHealthScoreAnswer = held(
  load<HealthProps>(
    () => import("@/components/health-score-answer").then((m) => ({ default: m.HealthScoreAnswer })),
    "Health score",
  ),
  "Health score",
  120,
);
export const LazyOwnerInsightFigures = held(
  load<InsightProps>(
    () => import("@/components/owner-insight-figures").then((m) => ({ default: m.OwnerInsightFigures })),
    "Overview",
  ),
  "Overview",
  320,
);
export const LazyOwnerBillingBridge = held(
  load<BillingProps>(
    () => import("@/components/owner-door/owner-billing-bridge").then((m) => ({ default: m.OwnerBillingBridge })),
    "Billing",
  ),
  "Billing",
  0,
);
export const LazyAdvisoryPackPanel = held(
  load<PackProps>(
    () => import("@/components/advisory-pack-panel").then((m) => ({ default: m.AdvisoryPackPanel })),
    "Advisory pack",
  ),
  "Advisory pack",
  480,
);
export const LazyCollectionsPanel = held(
  load<CollectionsProps>(
    () => import("@/components/collections-panel").then((m) => ({ default: m.CollectionsPanel })),
    "Collections",
  ),
  "Collections",
  480,
);
export const LazyPayablesPanel = held(
  load<PayablesProps>(
    () => import("@/components/payables-panel").then((m) => ({ default: m.PayablesPanel })),
    "Payables",
  ),
  "Payables",
  480,
);
export const LazyStrategicMovesPanel = held(
  load<MovesProps>(
    () => import("@/components/strategic-moves-panel").then((m) => ({ default: m.StrategicMovesPanel })),
    "Next moves",
  ),
  "Next moves",
  480,
);
export const LazyDataUpToDate = held(
  load<FreshProps>(
    () => import("@/components/data-up-to-date").then((m) => ({ default: m.DataUpToDate })),
    "Books",
  ),
  "Books",
  72,
);
export const LazyProfitWorkspace = held(
  load<ProfitProps>(
    () => import("@/components/profit/profit-workspace").then((m) => ({ default: m.ProfitWorkspace })),
    "Profit",
  ),
  "Profit",
  560,
);
export const LazyDeliverableInputConfig = held(
  load<InputsProps>(
    () => import("@/components/deliverable-input-config").then((m) => ({ default: m.DeliverableInputConfig })),
    "Inputs",
  ),
  "Inputs",
  240,
);
export const LazyPastPeriodUploadDialog = held(
  load<PastProps>(
    () => import("@/components/past-period-upload").then((m) => ({ default: m.PastPeriodUploadDialog })),
    "Past period",
  ),
  "Past period",
  0,
);
export const LazyTrialEndedPlanBlock = held(
  load<TrialProps>(
    () => import("@/components/trial-ended-plan-block").then((m) => ({ default: m.TrialEndedPlanBlock })),
    "Billing",
  ),
  "Billing",
  0,
);
