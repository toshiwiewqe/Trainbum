// ==========================================================
// Shared Firebase initialization — team's shared project.
// Import { auth } (and { db } if you need Firestore) from this
// file wherever needed, instead of re-initializing Firebase.
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB2Vq8eCDQR644VIwgcsupRrXwtH0jyWxs",
  authDomain: "trailbound-app.firebaseapp.com",
  projectId: "trailbound-app",
  storageBucket: "trailbound-app.firebasestorage.app",
  messagingSenderId: "404527291593",
  appId: "1:404527291593:web:11d3e65845c09cc9b30118",
  measurementId: "G-3PB84XCXFN"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);