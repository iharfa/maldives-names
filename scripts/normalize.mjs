/**
 * Normalization key for grouping name variants that are "the same name":
 *  - case-insensitive                     (HUvandhumaage = Huvandhumaage)
 *  - whitespace-insensitive               (Beach Villa = Beachvilla)
 *  - apostrophe-insensitive               (Dhan'buge = Dhanbuge — the apostrophe
 *    is a transliteration mark for Thaana prenasalisation, spelled unevenly)
 *  - dot/hyphen-insensitive               (K.K. Store = KK Store)
 *  - diacritic-insensitive                (Malé = Male)
 *
 * Used only as a grouping key — the displayed name is always the most common
 * surface spelling among the variants.
 */
export function normalizeName(s) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining diacritics (é -> e)
    .toLowerCase()
    .replace(/['’‘`´.\-–]/g, "")
    .replace(/\s+/g, "");
}
