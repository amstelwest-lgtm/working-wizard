/** ZA market only. A missing country and a US market stay off. */
export function taxSampleEnabled(country: string | null | undefined): boolean {
  return country === "ZA";
}

/**
 * Home sample card only. A real client stays blank.
 * Hand-off and the practice team use taxSampleEnabled and ignore this flag.
 */
export function taxSampleCardVisible(
  country: string | null | undefined,
  sampleClient: boolean,
): boolean {
  return taxSampleEnabled(country) && sampleClient === true;
}
