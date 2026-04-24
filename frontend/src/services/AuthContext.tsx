/**
 * AuthContext
 * ===========
 * Provides Firebase auth state to the entire app.
 * Wrap your app in <AuthProvider> and consume with useAuth() anywhere.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import {
  User,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, provider } from './firebase';

interface AuthContextValue {
  user:          User | null;
  loading:       boolean;
  signInGoogle:  () => Promise<void>;
  signOut:       () => Promise<void>;
  error:         string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [loading, setLoading] = useState(true);   // true until Firebase resolves session
  const [error,   setError]   = useState<string | null>(null);

  // Listen to Firebase auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;  // cleanup on unmount
  }, []);

  const signInGoogle = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, provider);
      // onAuthStateChanged will fire and set user automatically
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      // Ignore user-cancelled popup — not an error worth showing
      if (!msg.includes('popup-closed-by-user')) {
        setError('Sign-in failed. Please try again.');
        console.error('[Auth]', err);
      }
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInGoogle, signOut, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
