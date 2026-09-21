// ==========================================================
// firebase-config.js
// ----------------------------------------------------------
// This used to call initializeApp() a SECOND time with the same
// credentials, using the bundled npm SDK, while firebase-init.js
// created its own app from the gstatic CDN build.
//
// Two apps meant two separate auth states. Anything that imported
// `db` from here and `auth` from firebase-init.js — checkout.js,
// cart.js, payment-result.js — was handing Firestore a connection
// that had never seen the signed-in user. Public reads worked
// (trails, guides, packages, products are world-readable), so the
// site looked fine until the first authenticated WRITE, which
// failed with "Missing or insufficient permissions".
//
// It now re-exports the single shared app. Every existing import
// keeps working unchanged:
//
//     import { db } from "./firebase-config.js";   // still fine
//
// The five files that imported Firestore functions from
// "firebase/firestore" were switched to the same CDN build in the
// same change — a bundled updateDoc called against a CDN-built db
// fails, so both halves had to move together.
// ==========================================================

export { app, auth, db, isAdmin } from "./firebase-init.js";