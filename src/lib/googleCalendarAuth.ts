import { GoogleAuthProvider, signInWithPopup, User } from 'firebase/auth';
import { auth } from './firebase';

// Google Calendar Workspace OAuth Scopes requested for examination synchronization
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
];

let isSigningInWithGoogle = false;
let cachedCalendarAccessToken: string | null = null;
let cachedCalendarUser: User | null = null;

// Configure Google Auth Provider with Calendar Scopes
const calendarProvider = new GoogleAuthProvider();
CALENDAR_SCOPES.forEach((scope) => {
  calendarProvider.addScope(scope);
});
// Request offline/prompt consent to ensure clean token retrieval
calendarProvider.setCustomParameters({
  prompt: 'select_account'
});

/**
 * Safely detects whether the web application is running inside an iframe (e.g., AI Studio Preview).
 * Uses window.self !== window.top wrapped in a try/catch to gracefully handle cross-origin window access.
 */
export function isRunningInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // If accessing window.top throws a DOMException due to cross-origin sandboxing, it is definitely in an iframe
    return true;
  }
}

/**
 * Initiates Google Sign-In with Calendar Scopes and caches access token in memory.
 * Never stores token in localStorage or sessionStorage.
 */
export async function connectGoogleCalendar(): Promise<{ user: User; accessToken: string }> {
  if (isRunningInIframe()) {
    throw new Error('Connect your Google Calendar from the deployed SUN CBT website.');
  }

  try {
    isSigningInWithGoogle = true;
    const result = await signInWithPopup(auth, calendarProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);

    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Calendar authorization token from Google Account.');
    }

    cachedCalendarAccessToken = credential.accessToken;
    cachedCalendarUser = result.user;

    return {
      user: result.user,
      accessToken: credential.accessToken
    };
  } catch (error: any) {
    const code = error?.code || '';
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      console.warn('Google Calendar sign-in notice:', error);
    }
    throw error;
  } finally {
    isSigningInWithGoogle = false;
  }
}

/**
 * Get current in-memory cached access token
 */
export function getCalendarAccessToken(): string | null {
  return cachedCalendarAccessToken;
}

/**
 * Get current connected Google user
 */
export function getCalendarConnectedUser(): User | null {
  return cachedCalendarUser;
}

/**
 * Disconnect Google Calendar session from memory
 */
export function disconnectGoogleCalendar(): void {
  cachedCalendarAccessToken = null;
  cachedCalendarUser = null;
}
