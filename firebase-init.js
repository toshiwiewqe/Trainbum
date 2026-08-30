// ==========================================================
// Shared Firebase initialization.
// Import { auth } from this file wherever you need auth state,
// instead of re-initializing Firebase on every page.
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCJj71QZG4aTr8n54un-tRKRZq2CekWrtI",
  authDomain: "trailbound-app-1848a.firebaseapp.com",
  projectId: "trailbound-app-1848a",
  storageBucket: "trailbound-app-1848a.firebasestorage.app",
  messagingSenderId: "82691399098",
  appId: "1:82691399098:web:7d1282463081ba153e5183",
  measurementId: "G-3VV5GJQEJY"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);