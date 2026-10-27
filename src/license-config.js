// Menkyo license service for this product. Filled in once the production service is deployed;
// scripts/package.mjs refuses to build a release while either value is null, because a release
// that enforces the trial without a working purchase path would lock users out.
// For manual testing use `npm run try`, which points only dist/ at a test backend.
export const MENKYO_URL = 'https://menkyo.44san.com';
export const MENKYO_PUBLIC_JWK = {"kty": "EC", "crv": "P-256", "x": "e6UteJ3gQedK9rpT5dPD2rFB8D6aaZuW7tkCEKH1uEg", "y": "9FrHyGKq4Y0hAgw2TaIYKAsQ3cWKcMTSwRaH_C2LFDs"};
