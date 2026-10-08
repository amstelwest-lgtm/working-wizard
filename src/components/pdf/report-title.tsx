/**
 * ReportTitle — shared title block: gold-flanked kicker, headline, subtitle,
 * sample caption, and the signed or draft badge.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { pdfSignoffBadgeLine } from "@/lib/review-signoff-stamp";
import { C, T } from "./theme";
import { DemoNotice, DraftNotice, SampleNotice, SignedNotice } from "./watermark";
import { usePdfDraft, usePdfDraftLabel, usePdfSample, usePdfSignoff } from "./pdf-frame";
import { usePdfMarket } from "./pdf-market";

type Props = {
  kicker: string;
  title: string;
  subtitle?: string;
  isDemo?: boolean;
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  goldTick: { width: 18, height: 1, backgroundColor: C.gold },
  kicker: { ...T.kicker },
  title: { ...T.h1, marginBottom: 4 },
  subtitle: { fontSize: 9, fontFamily: "Helvetica", color: C.muted },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 2 },
});

export function ReportTitle({ kicker, title, subtitle, isDemo }: Props) {
  const signoff = usePdfSignoff();
  const sample = usePdfSample();
  const draft = usePdfDraft();
  const draftLabel = usePdfDraftLabel();
  const market = usePdfMarket();
  return (
    <View style={styles.wrap}>
      <View style={styles.kickerRow}>
        <View style={styles.goldTick} />
        <Text style={styles.kicker}>{kicker}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {sample ? <SampleNotice /> : null}
      {signoff || (draft && !isDemo) ? (
        <View style={styles.badges}>
          {draft && !isDemo ? <DraftNotice text={draftLabel} /> : null}
          {signoff ? <SignedNotice line={pdfSignoffBadgeLine(signoff, market)} /> : null}
        </View>
      ) : null}
      {isDemo && !sample ? (
        <View style={{ marginTop: 8 }}>
          <DemoNotice />
        </View>
      ) : null}
    </View>
  );
}
