/**
 * Site configuration for the TeamHero marketing site.
 *
 * All site-wide settings live here so they can be changed in one place.
 * The Google Analytics measurement ID should be replaced with a real
 * value before deploying to production.
 */
const SITE_CONFIG = {
  /** Google Analytics 4 measurement ID. Replace with your real ID. */
  gaMeasurementId: "G-5HZ44HPQKK",

  /** Product name used in prose (PascalCase). */
  productName: "TeamHero",

  /** CLI command name (lowercase, no hyphen). */
  cliCommand: "teamhero",

  /** Repository name (keep as-is, it is a URL/identifier). */
  repoName: "teamhero.scripts",

  /** Current CLI version. */
  version: "1.0.0",
};
