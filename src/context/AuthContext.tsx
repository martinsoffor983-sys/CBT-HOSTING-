import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  sendPasswordResetEmail
} from 'firebase/auth';
import { auth } from '../lib/firebase';

export const AUTHORIZED_LECTURER_EMAILS = [
  'sunsmartcbt@gmail.com',
  'sunsug539@gmail.com'
];

export function isAuthorizedExaminerEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return AUTHORIZED_LECTURER_EMAILS.includes(email.toLowerCase().trim());
}

export const AUTHORIZED_LECTURER_EMAIL = 'sunsmartcbt@gmail.com';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthorized: boolean;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    // Immediate synchronous check for unauthorized cached session
    if (auth.currentUser) {
      const email = (auth.currentUser.email || '').toLowerCase().trim();
      if (!isAuthorizedExaminerEmail(email)) {
        console.warn(`[Security Alert] Immediately evicting unauthorized cached session: ${email}`);
        signOut(auth).catch(() => {});
      }
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUser(null);
        setIsAuthorized(false);
        setLoading(false);
        return;
      }

      const userEmail = (currentUser.email || '').toLowerCase().trim();

      // Strict email gate: Authorized administrator emails
      if (!isAuthorizedExaminerEmail(userEmail)) {
        console.warn(`[Security Alert] Unauthorized account detected: ${userEmail}. Revoking session immediately.`);
        try {
          await signOut(auth);
        } catch {}
        setUser(null);
        setIsAuthorized(false);
        setLoading(false);
        return;
      }

      // Verify token with backend
      try {
        const idToken = await currentUser.getIdToken();
        const verifyRes = await fetch('/api/verify-lecturer', {
          headers: {
            Authorization: `Bearer ${idToken}`
          }
        });

        if (verifyRes.ok) {
          setUser(currentUser);
          setIsAuthorized(true);
        } else {
          const errJson = await verifyRes.json().catch(() => ({}));
          if (errJson.error && errJson.error.includes('Access Denied')) {
            try { await signOut(auth); } catch {}
            setUser(null);
            setIsAuthorized(false);
          } else {
            // For transient network hiccups or server restarts, retain authorized state for verified email
            setUser(currentUser);
            setIsAuthorized(true);
          }
        }
      } catch (err) {
        // Network timeout / transient fetch issue
        console.warn('Backend verification notice:', err);
        setUser(currentUser);
        setIsAuthorized(true);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, pass: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!isAuthorizedExaminerEmail(cleanEmail)) {
      throw new Error(`Access Restricted: Only authorized Sports University administrators are permitted.`);
    }

    const cred = await signInWithEmailAndPassword(auth, cleanEmail, pass);
    if (!cred.user) {
      throw new Error('Authentication failed. No user record returned by authentication provider.');
    }

    const userEmail = (cred.user.email || '').toLowerCase().trim();
    if (!isAuthorizedExaminerEmail(userEmail)) {
      await signOut(auth);
      throw new Error(`Access Denied: Account (${userEmail}) is not authorized as the university examiner.`);
    }

    // Server verification probe
    try {
      const idToken = await cred.user.getIdToken();
      const verifyRes = await fetch('/api/verify-lecturer', {
        headers: {
          Authorization: `Bearer ${idToken}`
        }
      });

      if (!verifyRes.ok) {
        const errJson = await verifyRes.json().catch(() => ({}));
        if (errJson.error && errJson.error.includes('Access Denied')) {
          await signOut(auth);
          throw new Error(errJson.error);
        }
      }
    } catch (vErr: any) {
      if (vErr?.message?.includes('Access Denied')) {
        throw vErr;
      }
      console.warn('Backend authorization check network notice:', vErr);
    }

    setUser(cred.user);
    setIsAuthorized(true);
  };

  const sendPasswordReset = async (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!isAuthorizedExaminerEmail(cleanEmail)) {
      throw new Error(`Access Restricted: Only authorized Sports University administrators are permitted.`);
    }

    await sendPasswordResetEmail(auth, cleanEmail);
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    setIsAuthorized(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthorized,
        signInWithEmail,
        sendPasswordReset,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
