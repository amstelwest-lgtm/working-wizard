/** ZA market only. A missing country and a US market stay off. */
export function taxSampleEnabled(country: string | null | undefined): boolean {
  return country === "ZA";
}

/**
 * Home card for every ZA client.
 * A demo client renders the sample card. A real client renders the preview card.
 * US and a missing country stay off. The sample module still loads only through the dynamic import.
 */
export function taxSampleCardVisible(
  country: string | null | undefined,
  _sampleClient?: boolean,
): boolean {
  return taxSampleEnabled(country);
}

/** Sample figures on the home card. A real client stays on the preview card. */
export function taxSampleFiguresVisible(
  country: string | null | undefined,
  sampleClient: boolean,
): boolean {
  return taxSampleEnabled(country) && sampleClient === true;
}
