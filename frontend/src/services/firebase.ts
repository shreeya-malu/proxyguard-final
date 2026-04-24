/**
 * ProxyGuard Studio — Firebase Service
 * =====================================
 * Initialises Firebase and exports auth, storage, and firestore.
 *
 * SETUP (one-time, takes ~5 minutes, completely free):
 *
 * 1. Go to https://console.firebase.google.com
 * 2. Create a project (or use your existing GCP project)
 * 3. Click "Add app" → Web → register app
 * 4. Copy the firebaseConfig values into your .env.development file
 * 5. In Firebase console → Authentication → Sign-in method → enable Google
 * 6. In Firebase console → Firestore Database → Create database (test mode is fine)
 * 7. In Firebase console → Storage → Get started
 *
 * All of the above is on the FREE Spark plan. No credit card needed.
 */

import { initializeApp, getApps }          from 'firebase/app';
import { getAuth, GoogleAuthProvider }      from 'firebase/auth';
import { getStorage }                       from 'firebase/storage';
import { getFirestore }                     from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// Prevent duplicate initialisation in dev (Vite HMR)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth     = getAuth(app);
export const provider = new GoogleAuthProvider();
export const storage  = getStorage(app);
export const db       = getFirestore(app);

// Prompt for Google account selection on every sign-in (better UX for multi-account users)
provider.setCustomParameters({ prompt: 'select_account' });

export default app;
