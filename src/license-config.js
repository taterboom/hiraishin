// Menkyo license service for this product. Filled in once the production service is deployed;
// scripts/package.mjs refuses to build a release while either value is null, because a release
// that enforces the trial without a working purchase path would lock users out.
// For manual testing use `npm run try`, which points only dist/ at a test backend.
export const MENKYO_URL = null; // e.g. 'https://menkyo.44san.com'
export const MENKYO_PUBLIC_JWK = null; // ES256 public JWK from Menkyo's GET /license/jwks
