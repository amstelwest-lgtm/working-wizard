import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";

type Props = {
  profile: AccountantProfile;
  smeName: string;
  period: string;
  fixed?: boolean;
};

const styles = StyleSheet.create({
  outer: {
    backgroundColor: "#ffffff",
  },
  wrapper: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 40,
    paddingTop: 28,
    paddingBottom: 16,
  },
  borderLine: {
    height: 2,
    marginHorizontal: 0,
  },
  left: {
    flex: 1,
    justifyContent: "center",
  },
  logoImage: {
    maxHeight: 40,
    maxWidth: 130,
    objectFit: "contain",
  },
  firmNameText: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.4,
  },
  tagline: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
    marginTop: 3,
    opacity: 0.65,
  },
  right: {
    alignItems: "flex-end",
  },
  preparedFor: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
    opacity: 0.55,
    marginBottom: 2,
  },
  smeName: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  period: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
    opacity: 0.6,
  },
  email: {
    fontSize: 7,
    fontFamily: "Helvetica",
    opacity: 0.45,
    marginTop: 3,
  },
});

export function ReportHeader({ profile, smeName, period, fixed }: Props) {
  const accentHex = profile.accentColor || "#0f3460";
  const primaryHex = profile.primaryColor || "#1a1a2e";

  return (
    <View style={styles.outer} fixed={fixed}>
      <View style={styles.wrapper}>
        <View style={styles.left}>
          {profile.logoUrl ? (
            <Image src={profile.logoUrl} style={styles.logoImage} />
          ) : (
            <>
              <Text style={[styles.firmNameText, { color: primaryHex }]}>
                {profile.firmName || "Your Firm"}
              </Text>
              {profile.tagline ? (
                <Text style={[styles.tagline, { color: primaryHex }]}>
                  {profile.tagline}
                </Text>
              ) : null}
            </>
          )}
        </View>

        <View style={styles.right}>
          <Text style={[styles.preparedFor, { color: primaryHex }]}>
            Prepared for:
          </Text>
          <Text style={[styles.smeName, { color: primaryHex }]}>{smeName}</Text>
          <Text style={[styles.period, { color: primaryHex }]}>
            Period: {period}
          </Text>
          {profile.accountantEmail ? (
            <Text style={[styles.email, { color: primaryHex }]}>
              {profile.accountantEmail}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.borderLine, { backgroundColor: accentHex }]} />
    </View>
  );
}
