// firebase-config.js
// Single shared Firebase connection for the whole project.
// Your classmate's Auth code should import `app` from here too,
// instead of calling initializeApp() again.

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB2Vq8eCDQR644VIwgcsupRrXwtH0jyWxs",
  authDomain: "trailbound-app.firebaseapp.com",
  projectId: "trailbound-app",
  storageBucket: "trailbound-app.firebasestorage.app",
  messagingSenderId: "404527291593",
  appId: "1:404527291593:web:11d3e65845c09cc9b30118",
  measurementId: "G-3PB84XCXFN"
};

const app = initializeApp(firebaseConfig);

// Firestore — this is our database connection
export const db = getFirestore(app);

// Exported in case other files (like your classmate's auth.js) need it
export { app };