/**
 * Firebase client SDK initializer — BROWSER ONLY.
 *
 * Used for SMS-based MFA enrollment + sign-in challenge. The client SDK
 * handles invisible reCAPTCHA, which Identity Platform requires before
 * sending an SMS verification.
 *
 * Loaded only on /admin/login and /admin/security via dynamic import in
 * the components that need it. Should never be imported from a server
 * component or API route — those use the firebase-admin SDK.
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

function config() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not set.");
  }
  return {
    apiKey,
    authDomain: `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "medspa-494718"}.firebaseapp.com`,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "medspa-494718",
  };
}

export function getClientAuth(): Auth {
  if (auth) return auth;
  if (!app) {
    app = getApps().length > 0 ? getApps()[0]! : initializeApp(config());
  }
  auth = getAuth(app);
  return auth;
}
