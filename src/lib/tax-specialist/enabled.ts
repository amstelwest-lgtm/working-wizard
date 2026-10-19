/** ZA market only. A missing country and a US market stay off. */
export function taxSampleEnabled(country: string | null | undefined): boolean {
  return country === "ZA";
}
