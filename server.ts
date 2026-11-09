import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  runTransaction,
  writeBatch,
  addDoc
} from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { TimerEnforcementManager } from './src/server/timerEnforcement.ts';
import {
  parseLagosExamTime,
  formatLagosDateTime,
  formatLagosDate,
  formatLagosTime,
  evaluateExamAccess,
  LAGOS_TIMEZONE
} from './src/utils/timeUtils.ts';
import {
  validateMatricNumber,
  capitalizeProper,
  detectBatchMatricDuplicates,
  isAnswerCorrect,
  validateAndReportCandidateBatch
} from './src/utils/studentValidation.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// In-flight mutex locks to prevent simultaneous duplicate submissions and registrations
const inFlightSubmissionLocks = new Set<string>();
const inFlightRegistrationLocks = new Set<string>();

// Initialize Firebase for server-side operations (support env overrides while keeping default config)
const effectiveFirebaseConfig = {
  ...firebaseConfig,
  apiKey: process.env.FIREBASE_API_KEY || firebaseConfig.apiKey,
  projectId: process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: process.env.FIREBASE_APP_ID || firebaseConfig.appId
};

const fbApp = initializeApp(effectiveFirebaseConfig, 'server-app');
const db = getFirestore(fbApp, effectiveFirebaseConfig.firestoreDatabaseId);

// Initialize Server-Side Timer Enforcement Utility
const timerManager = new TimerEnforcementManager(db);

// Initialize Google GenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || ''
});

// Configure body parser with high limit for PDF uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Healthcheck endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    institution: 'Sports University of Nigeria',
    service: 'SUN CBT Examination Engine',
    timestamp: new Date().toISOString()
  });
});

// Designated Authorized Lecturer Accounts
export const AUTHORIZED_LECTURER_EMAILS = [
  'sunsmartcbt@gmail.com',
  'sunsug539@gmail.com'
];
export const AUTHORIZED_LECTURER_EMAIL = 'sunsmartcbt@gmail.com';

// Helper to decode JWT payload supporting both base64url and base64
function decodeJwtPayload(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    try {
      return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    } catch {
      return null;
    }
  }
}

// Server-Side Lecturer Authorization Token Verification
export function verifyLecturerToken(req: Request): { authorized: boolean; email?: string; uid?: string; error?: string } {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authorized: false, error: 'Authorization header missing or invalid format. Bearer token required.' };
  }
  const idToken = authHeader.split('Bearer ')[1].trim();
  if (!idToken) {
    return { authorized: false, error: 'Authentication token missing.' };
  }

  try {
    const payload = decodeJwtPayload(idToken);
    if (!payload) {
      return { authorized: false, error: 'Malformed authentication token payload.' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    // 5-minute clock-skew grace window
    if (payload.exp && payload.exp < nowSec - 300) {
      return { authorized: false, error: 'Authentication token has expired. Please log in again.' };
    }

    // Supported university project IDs (handles environment variables with or without quotes)
    const allowedProjectIds = [
      (effectiveFirebaseConfig.projectId || '').replace(/^["']|["']$/g, '').trim(),
      (firebaseConfig.projectId || '').replace(/^["']|["']$/g, '').trim(),
      'gen-lang-client-0071022088'
    ].filter(Boolean);

    const tokenAud = (payload.aud || '').replace(/^["']|["']$/g, '').trim();
    const tokenIss = (payload.iss || '').trim();

    const matchesProject = allowedProjectIds.some(
      (pid) => tokenAud === pid || tokenIss.includes(pid)
    );

    if (!matchesProject) {
      return { authorized: false, error: 'Token audience or issuer does not match authorized university project.' };
    }

    // Extract email from all possible Firebase token fields
    const email = (
      payload.email ||
      payload.firebase?.identities?.email?.[0] ||
      payload.user_email ||
      ''
    ).toLowerCase().trim();

    if (!AUTHORIZED_LECTURER_EMAILS.includes(email)) {
      return { authorized: false, error: `Access Denied: Account (${email || 'unknown'}) is not authorized as the university examiner.` };
    }

    return { authorized: true, email, uid: payload.sub || payload.user_id };
  } catch (err: any) {
    return { authorized: false, error: 'Failed to verify token: ' + err?.message };
  }
}

// Lecturer Authorization Verification Endpoint
app.get('/api/verify-lecturer', (req: Request, res: Response) => {
  const result = verifyLecturerToken(req);
  if (!result.authorized) {
    res.status(401).json({ authorized: false, error: result.error });
    return;
  }
  res.json({ authorized: true, email: result.email, uid: result.uid });
});

// Delete Examination (Protected - Authorized Lecturer Only)
app.delete('/api/exam/:examId', async (req: Request, res: Response): Promise<void> => {
  try {
    const authCheck = verifyLecturerToken(req);
    if (!authCheck.authorized) {
      res.status(401).json({ error: authCheck.error || 'Access Denied: Lecturer authorization required.' });
      return;
    }
    const { examId } = req.params;
    const cleanId = (examId || '').trim();
    if (!cleanId) {
      res.status(400).json({ error: 'Valid examination ID required.' });
      return;
    }
    await deleteDoc(doc(db, 'exams', cleanId));
    res.json({ success: true, message: `Examination ${cleanId} deleted successfully.` });
  } catch (err: any) {
    console.error('Delete examination error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete examination.' });
  }
});

// Delete Examination Results Only (Protected - Authorized Administrator Only)
// Permanently deletes student submissions, answers, scores, and session attempts for this exam only.
// The examination, questions, correct answers, settings, duration, and publication status remain completely intact.
app.post('/api/exam/:examId/delete-results', async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Strict Server-Side Authorization Guard
    const authCheck = verifyLecturerToken(req);
    if (!authCheck.authorized) {
      res.status(401).json({ error: authCheck.error || 'Access Denied: Administrator authorization required to delete examination results.' });
      return;
    }

    // 2. Validate Examination ID on Server
    const { examId } = req.params;
    const cleanId = (examId || '').trim();
    if (!cleanId) {
      res.status(400).json({ error: 'Valid examination ID required.' });
      return;
    }

    const examDocRef = doc(db, 'exams', cleanId);
    const examSnap = await getDoc(examDocRef);
    if (!examSnap.exists()) {
      res.status(404).json({ error: `Examination ${cleanId} not found in database.` });
      return;
    }
    const examData = examSnap.data();

    // 3. Identify all dependent result records belonging exclusively to this examination
    const subsQuery = query(collection(db, 'submissions'), where('examId', '==', cleanId));
    const subsSnap = await getDocs(subsQuery);

    const sessionsQuery = query(collection(db, 'exam_sessions'), where('examId', '==', cleanId));
    const sessionsSnap = await getDocs(sessionsQuery);

    let deletedSubmissionsCount = 0;
    let deletedSessionsCount = 0;

    // 4. Safe Database Deletion: Batched writes for submissions
    const subDocs = subsSnap.docs;
    for (let i = 0; i < subDocs.length; i += 400) {
      const chunk = subDocs.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((docSnap) => {
        batch.delete(docSnap.ref);
        deletedSubmissionsCount++;
      });
      await batch.commit();
    }

    // 5. Safe Database Deletion: Batched writes for active/past exam sessions
    const sessionDocs = sessionsSnap.docs;
    for (let i = 0; i < sessionDocs.length; i += 400) {
      const chunk = sessionDocs.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((docSnap) => {
        batch.delete(docSnap.ref);
        deletedSessionsCount++;
      });
      await batch.commit();
    }

    // 6. Update examination timestamp (preserving registered candidates roster, attendance records, questions, options, settings, and duration)
    await updateDoc(examDocRef, {
      updatedAt: new Date().toISOString()
    });

    // 7. Evict in-memory timer tracking sessions for this exam
    timerManager.clearSessionsForExam(cleanId);

    // 8. Record audit log entry in audit_logs collection
    try {
      await addDoc(collection(db, 'audit_logs'), {
        action: 'DELETE_EXAMINATION_RESULTS',
        examId: cleanId,
        courseCode: examData.courseCode || 'N/A',
        courseTitle: examData.courseTitle || 'N/A',
        lecturerName: examData.lecturerName || 'Not specified',
        performedByEmail: authCheck.email,
        performedByUid: authCheck.uid || null,
        deletedSubmissionsCount,
        deletedSessionsCount,
        timestamp: new Date().toISOString()
      });
    } catch (auditErr) {
      console.warn('Could not record audit log entry:', auditErr);
    }

    res.json({
      success: true,
      message: `Results for examination ${examData.courseCode} (${cleanId}) have been permanently deleted. ${deletedSubmissionsCount} submission(s) and ${deletedSessionsCount} session(s) removed. The examination and questions remain unchanged.`,
      examId: cleanId,
      courseCode: examData.courseCode,
      deletedSubmissionsCount,
      deletedSessionsCount
    });
  } catch (err: any) {
    console.error('Delete examination results error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete examination results.' });
  }
});

// ==============================================================================
// PHASE 3A: EXAMINATION ATTENDANCE MANAGEMENT SYSTEM ENDPOINTS
// ==============================================================================

// 1. Get Attendance Register & Summary Statistics for an Examination
app.get('/api/exam/:examId/attendance', async (req: Request, res: Response): Promise<void> => {
  try {
    const authCheck = verifyLecturerToken(req);
    if (!authCheck.authorized) {
      res.status(401).json({ error: authCheck.error || 'Access Denied: Lecturer authorization required.' });
      return;
    }

    const { examId } = req.params;
    const cleanExamId = (examId || '').trim();
    if (!cleanExamId) {
      res.status(400).json({ error: 'Valid examination ID required.' });
      return;
    }

    const examDoc = await getDoc(doc(db, 'exams', cleanExamId));
    if (!examDoc.exists()) {
      res.status(404).json({ error: `Examination ${cleanExamId} not found.` });
      return;
    }
    const examData = examDoc.data();

    // 1. Fetch registered candidates from exam document
    const roster: any[] = Array.isArray(examData.registeredCandidates) ? examData.registeredCandidates : [];

    // 2. Fetch existing physical attendance records
    const attendanceQuery = query(collection(db, 'attendance_records'), where('examId', '==', cleanExamId));
    const attendanceSnap = await getDocs(attendanceQuery);
    const attendanceMap = new Map<string, any>();
    attendanceSnap.forEach((d) => {
      const data = d.data();
      if (data.matricNumber) {
        attendanceMap.set(String(data.matricNumber).trim().toUpperCase(), { ...data, id: d.id });
      }
    });

    // 3. Fetch submissions to display real submission status
    const subsQuery = query(collection(db, 'submissions'), where('examId', '==', cleanExamId));
    const subsSnap = await getDocs(subsQuery);
    const submissionsMap = new Map<string, any>();
    subsSnap.forEach((d) => {
      const data = d.data();
      if (data.matricNumber) {
        submissionsMap.set(String(data.matricNumber).trim().toUpperCase(), data);
      }
    });

    // 4. Combine all unique candidates
    const allMatrics = new Set<string>();
    roster.forEach((c: any) => {
      if (c.matricNumber) allMatrics.add(String(c.matricNumber).trim().toUpperCase());
    });
    attendanceMap.forEach((_, matric) => allMatrics.add(matric));
    submissionsMap.forEach((_, matric) => allMatrics.add(matric));

    const attendanceList: any[] = [];
    allMatrics.forEach((matric) => {
      const rosterEntry = roster.find((c: any) => String(c.matricNumber).trim().toUpperCase() === matric) || {};
      const attRecord = attendanceMap.get(matric) || {};
      const subRecord = submissionsMap.get(matric);

      const fullName = capitalizeProper(attRecord.fullName || rosterEntry.fullName || subRecord?.fullName || 'Candidate');
      const department = capitalizeProper(attRecord.department || rosterEntry.department || subRecord?.department || examData.department || 'Not Specified');
      const rawGender = attRecord.gender || rosterEntry.gender || subRecord?.gender || 'Not recorded';
      const gender = (rawGender === 'M' || String(rawGender).trim().toUpperCase() === 'M' || String(rawGender).trim().toUpperCase() === 'MALE')
        ? 'M'
        : (rawGender === 'F' || String(rawGender).trim().toUpperCase() === 'F' || String(rawGender).trim().toUpperCase() === 'FEMALE')
        ? 'F'
        : 'Not recorded';

      const signInTime = attRecord.signInTime || null;
      const signedInBy = attRecord.signedInBy || null;
      const signOutTime = attRecord.signOutTime || null;
      const signedOutBy = attRecord.signedOutBy || null;

      let status = attRecord.status || 'absent';
      if (signOutTime) {
        status = 'signed_out';
      } else if (signInTime) {
        status = 'signed_in';
      } else {
        status = 'absent';
      }

      let submissionStatus: 'not_started' | 'in_progress' | 'submitted' = 'not_started';
      if (subRecord) {
        submissionStatus = 'submitted';
      }

      attendanceList.push({
        id: attRecord.id || `${cleanExamId}_${matric.replace(/[^a-zA-Z0-9]/g, '_')}`,
        examId: cleanExamId,
        courseCode: examData.courseCode,
        courseTitle: examData.courseTitle,
        matricNumber: matric,
        fullName,
        department,
        gender,
        signInTime,
        signedInBy,
        signOutTime,
        signedOutBy,
        status,
        submissionStatus,
        submittedAt: subRecord?.submittedAt || null,
        submissionReceipt: subRecord?.submissionReceipt || null,
        score: subRecord?.score,
        totalQuestions: subRecord?.totalQuestions,
        percentage: subRecord?.percentage,
        updatedAt: attRecord.updatedAt || new Date().toISOString(),
        createdAt: attRecord.createdAt || rosterEntry.registeredAt || new Date().toISOString()
      });
    });

    // Sort alphabetically by Matriculation Number
    attendanceList.sort((a, b) => a.matricNumber.localeCompare(b.matricNumber));

    // Summary statistics calculated strictly from actual records
    const totalRegistered = attendanceList.length;
    const totalSignedIn = attendanceList.filter((a) => a.signInTime !== null).length;
    const totalSignedOut = attendanceList.filter((a) => a.signOutTime !== null).length;
    const totalCurrentlyInHall = attendanceList.filter((a) => a.signInTime !== null && a.signOutTime === null).length;
    const totalAbsent = attendanceList.filter((a) => a.signInTime === null).length;
    const totalSubmitted = attendanceList.filter((a) => a.submissionStatus === 'submitted').length;

    res.json({
      exam: {
        id: cleanExamId,
        courseCode: examData.courseCode,
        courseTitle: examData.courseTitle,
        department: examData.department,
        lecturerName: examData.lecturerName || 'Not specified',
        startDate: examData.startDate,
        endDate: examData.endDate,
        status: examData.status
      },
      summary: {
        totalRegistered,
        totalSignedIn,
        totalSignedOut,
        totalCurrentlyInHall,
        totalAbsent,
        totalSubmitted
      },
      attendanceList
    });
  } catch (error: any) {
    console.error('Error fetching examination attendance:', error);
    res.status(500).json({ error: error?.message || 'Failed to retrieve attendance register.' });
  }
});

// 2. Record Physical Candidate Sign-In
app.post('/api/exam/:examId/attendance/sign-in', async (req: Request, res: Response): Promise<void> => {
  try {
    const authCheck = verifyLecturerToken(req);
    if (!authCheck.authorized) {
      res.status(401).json({ error: authCheck.error || 'Access Denied: Lecturer authorization required.' });
      return;
    }

    const { examId } = req.params;
    const { matricNumber, fullName, department, gender } = req.body;

    const cleanExamId = (examId || '').trim();
    if (!cleanExamId) {
      res.status(400).json({ error: 'Valid examination ID required.' });
      return;
    }

    const examDoc = await getDoc(doc(db, 'exams', cleanExamId));
    if (!examDoc.exists()) {
      res.status(404).json({ error: `Examination ${cleanExamId} not found.` });
      return;
    }
    const examData = examDoc.data();

    const matricValidation = validateMatricNumber(matricNumber);
    if (!matricValidation.isValid) {
      res.status(400).json({ error: matricValidation.error || 'Invalid matriculation number format.' });
      return;
    }
    const normalizedMatric = matricValidation.normalized;

    const recordId = `${cleanExamId}_${normalizedMatric.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const recordRef = doc(db, 'attendance_records', recordId);
    const existingSnap = await getDoc(recordRef);

    // Rule 5: Duplicate attendance actions are prevented
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      if (existingData.signInTime) {
        res.status(400).json({
          error: `Duplicate sign-in prevented: Student ${normalizedMatric} was already signed in at ${formatLagosTime(existingData.signInTime)} by ${existingData.signedInBy || 'Invigilator'}.`
        });
        return;
      }
    }

    // Resolve name & details from request, existing roster, or session
    const roster: any[] = Array.isArray(examData.registeredCandidates) ? examData.registeredCandidates : [];
    const rosterCandidate = roster.find((c: any) => String(c.matricNumber).trim().toUpperCase() === normalizedMatric);

    const resolvedName = capitalizeProper(fullName || rosterCandidate?.fullName || existingSnap.data()?.fullName || 'Candidate');
    const resolvedDept = capitalizeProper(department || rosterCandidate?.department || existingSnap.data()?.department || examData.department || 'All Departments');
    const rawGender = gender || rosterCandidate?.gender || existingSnap.data()?.gender;
    const resolvedGender = (rawGender === 'M' || String(rawGender).trim().toUpperCase() === 'M' || String(rawGender).trim().toUpperCase() === 'MALE')
      ? 'M'
      : (rawGender === 'F' || String(rawGender).trim().toUpperCase() === 'F' || String(rawGender).trim().toUpperCase() === 'FEMALE')
      ? 'F'
      : 'Not recorded';

    const nowIso = new Date().toISOString();

    const attendanceData = {
      id: recordId,
      examId: cleanExamId,
      courseCode: examData.courseCode,
      courseTitle: examData.courseTitle,
      matricNumber: normalizedMatric,
      fullName: resolvedName,
      department: resolvedDept,
      gender: resolvedGender,
      signInTime: nowIso,
      signedInBy: authCheck.email || 'sunsmartcbt@gmail.com',
      signOutTime: existingSnap.data()?.signOutTime || null,
      signedOutBy: existingSnap.data()?.signedOutBy || null,
      status: 'signed_in',
      updatedAt: nowIso,
      createdAt: existingSnap.data()?.createdAt || nowIso
    };

    await setDoc(recordRef, attendanceData, { merge: true });

    // Also ensure candidate is included in exam roster if not already present
    if (!rosterCandidate) {
      try {
        await updateDoc(doc(db, 'exams', cleanExamId), {
          registeredCandidates: [
            ...roster,
            {
              matricNumber: normalizedMatric,
              fullName: resolvedName,
              department: resolvedDept,
              gender: resolvedGender,
              addedAt: nowIso
            }
          ]
        });
      } catch (rErr) {
        console.warn('Notice updating exam roster on sign-in:', rErr);
      }
    }

    res.json({
      success: true,
      message: `Candidate ${resolvedName} (${normalizedMatric}) signed in successfully at ${formatLagosTime(nowIso)} (WAT).`,
      record: attendanceData
    });
  } catch (error: any) {
    console.error('Error recording sign-in:', error);
    res.status(500).json({ error: error?.message || 'Failed to record candidate sign-in.' });
  }
});

// 3. Record Physical Candidate Sign-Out
app.post('/api/exam/:examId/attendance/sign-out', async (req: Request, res: Response): Promise<void> => {
  try {
    const authCheck = verifyLecturerToken(req);
    if (!authCheck.authorized) {
      res.status(401).json({ error: authCheck.error || 'Access Denied: Lecturer authorization required.' });
      return;
    }

    const { examId } = req.params;
    const { matricNumber } = req.body;

    const cleanExamId = (examId || '').trim();
    if (!cleanExamId) {
      res.status(400).json({ error: 'Valid examination ID required.' });
      return;
    }

    const matricValidation = validateMatricNumber(matricNumber);
    if (!matricValidation.isValid) {
      res.status(400).json({ error: matricValidation.error || 'Invalid matriculation number format.' });
      return;
    }
    const normalizedMatric = matricValidation.normalized;

    const recordId = `${cleanExamId}_${normalizedMatric.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const recordRef = doc(db, 'attendance_records', recordId);
    const existingSnap = await getDoc(recordRef);

    // Rule 6: Students cannot sign out before signing in
    if (!existingSnap.exists() || !existingSnap.data()?.signInTime) {
      res.status(400).json({
        error: `Cannot sign out: Student ${normalizedMatric} has not signed in yet. Physical sign-in is required before sign-out.`
      });
      return;
    }

    const existingData = existingSnap.data();

    // Rule 5: Duplicate attendance actions are prevented
    if (existingData.signOutTime) {
      res.status(400).json({
        error: `Duplicate sign-out prevented: Student ${normalizedMatric} already signed out at ${formatLagosTime(existingData.signOutTime)}.`
      });
      return;
    }

    const nowIso = new Date().toISOString();

    const updatedData = {
      signOutTime: nowIso,
      signedOutBy: authCheck.email || 'sunsmartcbt@gmail.com',
      status: 'signed_out',
      updatedAt: nowIso
    };

    await updateDoc(recordRef, updatedData);

    res.json({
      success: true,
      message: `Candidate ${existingData.fullName || normalizedMatric} signed out successfully at ${formatLagosTime(nowIso)} (WAT).`,
      record: { ...existingData, ...updatedData }
    });
  } catch (error: any) {
    console.error('Error recording sign-out:', error);
    res.status(500).json({ error: error?.message || 'Failed to record candidate sign-out.' });
  }
});

// 4. Admit / Pre-register Candidate Directly in Attendance Register
app.post('/api/exam/:examId/attendance/admit', async (req: Request, res: Response): Promise<void> => {
  try {
    const authCheck = verifyLecturerToken(req);
    if (!authCheck.authorized) {
      res.status(401).json({ error: authCheck.error || 'Access Denied: Lecturer authorization required.' });
      return;
    }

    const { examId } = req.params;
    const { matricNumber, fullName, department, gender, autoSignIn = true } = req.body;

    const cleanExamId = (examId || '').trim();
    if (!cleanExamId) {
      res.status(400).json({ error: 'Valid examination ID required.' });
      return;
    }

    const examDoc = await getDoc(doc(db, 'exams', cleanExamId));
    if (!examDoc.exists()) {
      res.status(404).json({ error: `Examination ${cleanExamId} not found.` });
      return;
    }
    const examData = examDoc.data();

    const matricValidation = validateMatricNumber(matricNumber);
    if (!matricValidation.isValid) {
      res.status(400).json({ error: matricValidation.error || 'Invalid matriculation number format.' });
      return;
    }
    const normalizedMatric = matricValidation.normalized;

    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      res.status(400).json({ error: 'Student full name is required.' });
      return;
    }

    const cleanedFullName = capitalizeProper(fullName);
    const cleanedDept = capitalizeProper(department || examData.department || 'All Departments');
    const resolvedGender = (gender === 'M' || String(gender).trim().toUpperCase() === 'M' || String(gender).trim().toUpperCase() === 'MALE')
      ? 'M'
      : (gender === 'F' || String(gender).trim().toUpperCase() === 'F' || String(gender).trim().toUpperCase() === 'FEMALE')
      ? 'F'
      : 'Not recorded';

    const nowIso = new Date().toISOString();
    const recordId = `${cleanExamId}_${normalizedMatric.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const recordRef = doc(db, 'attendance_records', recordId);

    const recordData = {
      id: recordId,
      examId: cleanExamId,
      courseCode: examData.courseCode,
      courseTitle: examData.courseTitle,
      matricNumber: normalizedMatric,
      fullName: cleanedFullName,
      department: cleanedDept,
      gender: resolvedGender,
      signInTime: autoSignIn ? nowIso : null,
      signedInBy: autoSignIn ? (authCheck.email || 'sunsmartcbt@gmail.com') : null,
      signOutTime: null,
      signedOutBy: null,
      status: autoSignIn ? 'signed_in' : 'absent',
      updatedAt: nowIso,
      createdAt: nowIso
    };

    await setDoc(recordRef, recordData, { merge: true });

    // Update roster on exam document
    const roster: any[] = Array.isArray(examData.registeredCandidates) ? examData.registeredCandidates : [];
    const existsInRoster = roster.some((c: any) => String(c.matricNumber).trim().toUpperCase() === normalizedMatric);
    if (!existsInRoster) {
      await updateDoc(doc(db, 'exams', cleanExamId), {
        registeredCandidates: [
          ...roster,
          {
            matricNumber: normalizedMatric,
            fullName: cleanedFullName,
            department: cleanedDept,
            gender: resolvedGender,
            addedAt: nowIso
          }
        ]
      });
    }

    res.json({
      success: true,
      message: `Candidate ${cleanedFullName} (${normalizedMatric}) successfully admitted and registered for this examination.`,
      record: recordData
    });
  } catch (error: any) {
    console.error('Error admitting candidate:', error);
    res.status(500).json({ error: error?.message || 'Failed to admit candidate.' });
  }
});

// 5. Attendance Correction / Reset (Audited)
app.post('/api/exam/:examId/attendance/reset', async (req: Request, res: Response): Promise<void> => {
  try {
    const authCheck = verifyLecturerToken(req);
    if (!authCheck.authorized) {
      res.status(401).json({ error: authCheck.error || 'Access Denied: Lecturer authorization required.' });
      return;
    }

    const { examId } = req.params;
    const { matricNumber, reason = 'Administrative attendance correction' } = req.body;

    const cleanExamId = (examId || '').trim();
    const matricValidation = validateMatricNumber(matricNumber);
    if (!matricValidation.isValid) {
      res.status(400).json({ error: matricValidation.error || 'Invalid matriculation number.' });
      return;
    }
    const normalizedMatric = matricValidation.normalized;

    const recordId = `${cleanExamId}_${normalizedMatric.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const recordRef = doc(db, 'attendance_records', recordId);
    const snap = await getDoc(recordRef);

    if (!snap.exists()) {
      res.status(404).json({ error: `Attendance record for ${normalizedMatric} not found.` });
      return;
    }

    const prevData = snap.data();
    const nowIso = new Date().toISOString();

    await updateDoc(recordRef, {
      signInTime: null,
      signedInBy: null,
      signOutTime: null,
      signedOutBy: null,
      status: 'absent',
      updatedAt: nowIso
    });

    // Rule 7: Attendance corrections are audited
    try {
      await addDoc(collection(db, 'audit_logs'), {
        action: 'ATTENDANCE_CORRECTION_RESET',
        examId: cleanExamId,
        matricNumber: normalizedMatric,
        candidateName: prevData.fullName,
        performedByEmail: authCheck.email,
        reason,
        previousState: {
          signInTime: prevData.signInTime,
          signOutTime: prevData.signOutTime,
          status: prevData.status
        },
        timestamp: nowIso
      });
    } catch (auditErr) {
      console.warn('Could not record attendance audit log:', auditErr);
    }

    res.json({
      success: true,
      message: `Attendance for ${normalizedMatric} (${prevData.fullName}) has been reset to absent. This correction was logged in audit records.`
    });
  } catch (error: any) {
    console.error('Error resetting attendance:', error);
    res.status(500).json({ error: error?.message || 'Failed to correct attendance.' });
  }
});

// 1. PDF Question Extraction via Gemini (Protected - Lecturer Only)
app.post('/api/extract-questions', async (req: Request, res: Response): Promise<void> => {
  try {
    // Server-side authorization guard
    const authCheck = verifyLecturerToken(req);
    if (!authCheck.authorized) {
      res.status(401).json({ error: authCheck.error || 'Access Denied: Lecturer authorization required.' });
      return;
    }

    const { pdfBase64, mimeType = 'application/pdf', textContent } = req.body;

    if (!pdfBase64 && !textContent) {
      res.status(400).json({ error: 'Please provide either a PDF file or text content.' });
      return;
    }

    // Gracefully handle missing GEMINI_API_KEY in external hosting environments like Render
    if (!process.env.GEMINI_API_KEY) {
      if (textContent) {
        const fallbackQuestions = parseQuestionsFromTextFallback(textContent);
        if (fallbackQuestions.length > 0) {
          res.json({
            success: true,
            count: fallbackQuestions.length,
            questions: fallbackQuestions
          });
          return;
        }
      }
      res.status(400).json({
        error: 'GEMINI_API_KEY is not configured on this server. To extract questions from PDF documents using Gemini AI, please set the GEMINI_API_KEY environment variable in your Render dashboard (available free from Google AI Studio). Alternatively, you can paste the examination text directly or create questions manually.'
      });
      return;
    }

    const systemInstruction = `You are a Senior Academic Examination Specialist at Sports University of Nigeria (SUN CBT - Citadel for Champions).
Your task is to parse, format, and structure multiple-choice examination questions from uploaded examination question papers (PDFs or text).

Assumptions and Rules:
1. The uploaded document contains multiple-choice questions with 4 options (Option A, Option B, Option C, Option D) and the correct answer clearly indicated in the document (e.g., through bolding, asterisks like *A, bracketed indicators like [Ans: C], "Answer: B", key list at bottom, or highlighted text).
2. For each question, extract:
   - "questionNumber": The original question number (e.g., 1, 2, 3...)
   - "questionText": The complete question stem, free of question number prefixes (e.g. without "1.", "Q2:").
   - "options": An array of exactly 4 strings [Option A, Option B, Option C, Option D]. Remove prefixes like "A.", "B)", "(C)", "[D]" from each option text.
   - "correctAnswer": The 0-based index of the clearly indicated correct option (0 for A, 1 for B, 2 for C, 3 for D).
   - "explanation": A concise academic rationale or justification for the answer.
3. If any question has fewer than 4 options in the source document, intelligently provide plausible distractors to ensure exactly 4 options.
4. Output strictly a JSON array of objects conforming to:
[
  {
    "questionNumber": 1,
    "questionText": "Which physiological system is primarily responsible for the rapid resynthesis of ATP during a 100-meter sprint?",
    "options": [
      "Phosphagen (ATP-PCr) System",
      "Aerobic Glycolysis System",
      "Beta-Oxidation System",
      "Cori Cycle"
    ],
    "correctAnswer": 0,
    "explanation": "The ATP-PCr system resynthesizes ATP rapidly for maximal exertion lasting under 10 seconds."
  }
]`;

    let parts: any[] = [];
    if (pdfBase64) {
      parts.push({
        inlineData: {
          data: pdfBase64,
          mimeType: mimeType
        }
      });
      parts.push({
        text: 'Extract and format all multiple choice questions with their question numbers, 4 options (A-D), indicated correct answers, and academic explanations from this Sports University examination paper.'
      });
    } else {
      parts.push({
        text: `Extract and format all multiple choice questions with their question numbers, 4 options (A-D), indicated correct answers, and academic explanations from this examination text:\n\n${textContent}`
      });
    }

    const candidateModels = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
    let outputText = '[]';
    let lastError = null;

    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts
            }
          ],
          config: {
            systemInstruction,
            responseMimeType: 'application/json'
          }
        });
        if (response.text) {
          outputText = response.text;
          lastError = null;
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn(`Extraction with ${modelName} encountered error, trying next fallback:`, err);
      }
    }

    if (lastError && outputText === '[]') {
      if (textContent) {
        const fallbackQuestions = parseQuestionsFromTextFallback(textContent);
        if (fallbackQuestions.length > 0) {
          res.json({
            success: true,
            count: fallbackQuestions.length,
            questions: fallbackQuestions
          });
          return;
        }
      }
      throw lastError;
    }

    let questions = [];
    try {
      questions = JSON.parse(outputText);
    } catch {
      // If output had markdown formatting
      const cleaned = outputText.replace(/```json/g, '').replace(/```/g, '').trim();
      questions = JSON.parse(cleaned);
    }

    // Sanitize and ensure 4 options and IDs
    const formattedQuestions = questions.map((q: any, index: number) => {
      const opts = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
      while (opts.length < 4) {
        opts.push(`Option ${String.fromCharCode(65 + opts.length)}`);
      }
      return {
        id: `q_${Date.now()}_${index}`,
        questionText: q.questionText || `Question ${index + 1}`,
        options: opts as [string, string, string, string],
        correctAnswer: typeof q.correctAnswer === 'number' && q.correctAnswer >= 0 && q.correctAnswer <= 3 ? q.correctAnswer : 0,
        explanation: q.explanation || ''
      };
    });

    res.json({
      success: true,
      count: formattedQuestions.length,
      questions: formattedQuestions
    });
  } catch (error: any) {
    console.error('Gemini extraction error:', error);
    res.status(500).json({
      error: error?.message || 'Failed to extract examination questions using Gemini.'
    });
  }
});

// Robust Parser Fallback for structured question papers
function parseQuestionsFromTextFallback(rawText: string) {
  const blocks = rawText.split(/(?=(?:^|\n)\s*(?:\d+[\.\)]|Question\s*\d+[:\.]))/i).filter((b) => b.trim());
  const questions: any[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const optMatchA = block.match(/(?:^|\n)\s*(?:[A\(\[]\s*[\.\)]|\*?A[\.\)])\s*([^\n]+)/i);
    const optMatchB = block.match(/(?:^|\n)\s*(?:[B\(\[]\s*[\.\)]|\*?B[\.\)])\s*([^\n]+)/i);
    const optMatchC = block.match(/(?:^|\n)\s*(?:[C\(\[]\s*[\.\)]|\*?C[\.\)])\s*([^\n]+)/i);
    const optMatchD = block.match(/(?:^|\n)\s*(?:[D\(\[]\s*[\.\)]|\*?D[\.\)])\s*([^\n]+)/i);

    if (optMatchA && optMatchB) {
      const firstOptPos = block.search(/(?:^|\n)\s*(?:[A\(\[]\s*[\.\)]|\*?A[\.\)])/i);
      let stem = firstOptPos > 0 ? block.slice(0, firstOptPos).trim() : `Question ${i + 1}`;
      stem = stem.replace(/^\d+[\.\)]\s*/, '').replace(/^Question\s*\d+[:\.]\s*/i, '').trim();

      let correctIdx = 0;
      const ansMatch = block.match(/(?:Answer|Ans|Key|Correct(?:\s*Option)?)\s*[:=\-]?\s*([A-D])/i);
      if (ansMatch) {
        const letter = ansMatch[1].toUpperCase();
        correctIdx = letter === 'B' ? 1 : letter === 'C' ? 2 : letter === 'D' ? 3 : 0;
      } else if (/\*A[\.\)]/i.test(block)) {
        correctIdx = 0;
      } else if (/\*B[\.\)]/i.test(block)) {
        correctIdx = 1;
      } else if (/\*C[\.\)]/i.test(block)) {
        correctIdx = 2;
      } else if (/\*D[\.\)]/i.test(block)) {
        correctIdx = 3;
      }

      let explanation = '';
      const expMatch = block.match(/(?:Explanation|Rationale|Note)\s*[:=\-]?\s*([^\n]+)/i);
      if (expMatch) {
        explanation = expMatch[1].trim();
      }

      questions.push({
        id: `q_${Date.now()}_${i}`,
        questionText: stem || `Question ${i + 1}`,
        options: [
          optMatchA ? optMatchA[1].trim() : 'Option A',
          optMatchB ? optMatchB[1].trim() : 'Option B',
          optMatchC ? optMatchC[1].trim() : 'Option C',
          optMatchD ? optMatchD[1].trim() : 'Option D'
        ],
        correctAnswer: correctIdx,
        explanation
      });
    }
  }

  return questions;
}

// Helper to safely parse exam date/time strings in Africa/Lagos timezone
export const parseExamTime = parseLagosExamTime;

// Server Time Endpoint (Authoritative Africa/Lagos clock synchronization)
app.get('/api/server-time', (_req: Request, res: Response) => {
  const now = Date.now();
  res.json({
    serverTime: now,
    iso: new Date(now).toISOString(),
    lagosTime: formatLagosDateTime(now),
    timeZone: LAGOS_TIMEZONE
  });
});

// Candidate Verification Endpoint (Pre-check duplicate submission, access window and eligibility)
app.post('/api/verify-candidate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { examId, matricNumber, fullName, department, gender } = req.body;
    if (!examId || !matricNumber) {
      res.status(400).json({ error: 'Exam ID and Matriculation Number required.' });
      return;
    }
    const cleanExamId = (examId || '').trim();
    const matricVal = validateMatricNumber(matricNumber);
    if (!matricVal.isValid) {
      res.status(400).json({ error: matricVal.error });
      return;
    }
    const normalizedMatric = matricVal.normalized;

    // 1. Fetch exam
    const examDoc = await getDoc(doc(db, 'exams', cleanExamId));
    if (!examDoc.exists()) {
      res.status(404).json({ error: 'Invalid Exam ID. Please check the ID provided by your lecturer.' });
      return;
    }
    const examData = examDoc.data();

    // Central Access Evaluation in Africa/Lagos time
    const access = evaluateExamAccess({
      startDate: examData.startDate,
      endDate: examData.endDate,
      status: examData.status
    }, Date.now());

    if (!access.allowed) {
      res.status(400).json({
        error: access.errorMessage || 'Invalid Exam ID. Please check the ID provided by your lecturer.',
        isClosed: access.status === 'closed',
        notYetOpen: access.status === 'not_yet_open'
      });
      return;
    }

    // Duplicate Check: Check if session exists and is already submitted for this exam
    const sessionId = `ses_${cleanExamId}_${normalizedMatric.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const sessionSnap = await getDoc(doc(db, 'exam_sessions', sessionId));
    if (sessionSnap.exists() && sessionSnap.data()?.status === 'submitted') {
      res.status(400).json({
        error: `Duplicate Registration Error: Candidate with Matriculation Number ${normalizedMatric} has already submitted this examination. Reopening or retaking this examination is strictly prohibited.`,
        alreadySubmitted: true
      });
      return;
    }

    res.json({
      eligible: true,
      matricNumber: normalizedMatric,
      examId: cleanExamId
    });
  } catch (err: any) {
    console.error('Candidate verify error:', err);
    res.status(500).json({ error: 'Failed to verify candidate eligibility.' });
  }
});

// Candidate Examination Registration Endpoint with Atomic Transaction & Duplicate Detection
app.post('/api/register-candidate', async (req: Request, res: Response): Promise<void> => {
  const { examId, matricNumber, fullName, department, gender } = req.body;
  if (!examId || !matricNumber || !fullName || !department) {
    res.status(400).json({ error: 'Exam ID, Matriculation Number, Full Name, and Department are required.' });
    return;
  }
  const cleanExamId = (examId || '').trim();
  const matricVal = validateMatricNumber(matricNumber);
  if (!matricVal.isValid) {
    res.status(400).json({ error: matricVal.error });
    return;
  }
  const normalizedMatric = matricVal.normalized;
  const normalizedFullName = capitalizeProper(fullName || '');
  const normalizedDept = capitalizeProper(department || '');
  const cleanGender = (g: any): string => {
    if (!g) return 'Not recorded';
    const s = String(g).trim().toUpperCase();
    if (s === 'M' || s === 'MALE') return 'M';
    if (s === 'F' || s === 'FEMALE') return 'F';
    return 'Not recorded';
  };
  const resolvedGender = cleanGender(gender);

  // In-flight mutex lock to prevent simultaneous duplicate registrations
  const lockKey = `${cleanExamId}_${normalizedMatric}`;
  if (inFlightRegistrationLocks.has(lockKey)) {
    res.status(409).json({
      error: `A registration for matriculation number ${normalizedMatric} is currently being processed. Duplicate simultaneous registrations are prevented.`
    });
    return;
  }
  inFlightRegistrationLocks.add(lockKey);

  try {
    const examDocRef = doc(db, 'exams', cleanExamId);
    let isDuplicate = false;
    let alreadySubmitted = false;

    await runTransaction(db, async (transaction) => {
      const examSnap = await transaction.get(examDocRef);
      if (!examSnap.exists()) {
        throw new Error('Examination record not found.');
      }
      const examData = examSnap.data();

      // Check if session exists and is already submitted for this exam
      const sesId = `ses_${cleanExamId}_${normalizedMatric.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const sesDocRef = doc(db, 'exam_sessions', sesId);
      const sesSnap = await transaction.get(sesDocRef);
      if (sesSnap.exists() && sesSnap.data()?.status === 'submitted') {
        alreadySubmitted = true;
        return;
      }

      const roster: any[] = Array.isArray(examData.registeredCandidates) ? examData.registeredCandidates : [];
      const existing = roster.some(c => (c.matricNumber || '').trim().toUpperCase() === normalizedMatric);
      if (existing) {
        isDuplicate = true;
        return;
      }

      // Add new candidate atomically to roster
      const newCandidate = {
        matricNumber: normalizedMatric,
        fullName: normalizedFullName,
        department: normalizedDept,
        gender: resolvedGender,
        registeredAt: new Date().toISOString()
      };

      transaction.update(examDocRef, {
        registeredCandidates: [...roster, newCandidate],
        updatedAt: new Date().toISOString()
      });
    });

    if (alreadySubmitted) {
      res.status(400).json({
        error: `Duplicate Registration Error: Candidate with Matriculation Number ${normalizedMatric} has already submitted this examination. Reopening or retaking this examination is strictly prohibited.`,
        alreadySubmitted: true
      });
      return;
    }

    if (isDuplicate) {
      res.status(400).json({
        error: `Duplicate Registration Error: Candidate with Matriculation Number ${normalizedMatric} has already been registered for this examination. Duplicate entries within the same examination are strictly prohibited.`,
        duplicate: true
      });
      return;
    }

    res.json({
      success: true,
      matricNumber: normalizedMatric,
      examId: cleanExamId,
      message: `Candidate ${normalizedMatric} successfully registered for examination.`
    });
  } catch (err: any) {
    console.error('Candidate registration error:', err);
    res.status(500).json({ error: err?.message || 'Failed to register candidate.' });
  } finally {
    inFlightRegistrationLocks.delete(lockKey);
  }
});

// 2. List all publicly published examinations
app.get('/api/exams-public', async (_req: Request, res: Response): Promise<void> => {
  try {
    const q = query(collection(db, 'exams'), where('status', '==', 'published'));
    const snap = await getDocs(q);
    const list: any[] = [];
    const now = Date.now();

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const access = evaluateExamAccess({
        startDate: data.startDate,
        endDate: data.endDate,
        status: data.status
      }, now);

      list.push({
        id: docSnap.id,
        courseCode: data.courseCode,
        courseTitle: data.courseTitle,
        department: data.department,
        lecturerName: data.lecturerName || 'Not specified',
        durationMinutes: data.durationMinutes,
        startDate: data.startDate,
        endDate: data.endDate,
        questionsCount: data.questionsCount || (Array.isArray(data.questions) ? data.questions.length : 0),
        targetQuestionsCount: data.targetQuestionsCount || data.questionsCount || (Array.isArray(data.questions) ? data.questions.length : 0),
        status: access.status === 'closed' ? 'closed' : data.status,
        isClosed: access.status === 'closed',
        notYetOpen: access.status === 'not_yet_open',
        opensAtLagos: access.opensAtLagos,
        closesAtLagos: access.closesAtLagos
      });
    });
    res.json({ exams: list });
  } catch (error: any) {
    console.error('Error fetching public exams list:', error);
    res.status(500).json({ error: 'Failed to retrieve available examinations.' });
  }
});

// 3. Public Exam Info (Safe for students before starting)
app.get('/api/exam-public/:examId', async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const { examId } = req.params;
    const cleanExamId = (examId || '').trim();

    if (!cleanExamId) {
      res.status(400).json({ error: 'Invalid Exam ID. Please check the ID provided by your lecturer.' });
      return;
    }

    const examDoc = await getDoc(doc(db, 'exams', cleanExamId));

    if (!examDoc.exists()) {
      res.status(404).json({ error: 'Invalid Exam ID. Please check the ID provided by your lecturer.' });
      return;
    }

    const data = examDoc.data();
    if (!data || data.status !== 'published') {
      res.status(400).json({
        error: 'Invalid Exam ID. Please check the ID provided by your lecturer.'
      });
      return;
    }

    const now = Date.now();
    const access = evaluateExamAccess({
      startDate: data.startDate,
      endDate: data.endDate,
      status: data.status
    }, now);

    // Rule 1 & Rule 3: Enforce Opening and Closing bounds
    if (!access.allowed) {
      res.status(400).json({
        error: access.errorMessage || 'Invalid Exam ID. Please check the ID provided by your lecturer.',
        isClosed: access.status === 'closed',
        notYetOpen: access.status === 'not_yet_open',
        closedAt: access.closeTimeMs ? new Date(access.closeTimeMs).toISOString() : undefined,
        opensAt: access.openTimeMs ? new Date(access.openTimeMs).toISOString() : undefined,
        closesAtLagos: access.closesAtLagos,
        opensAtLagos: access.opensAtLagos
      });
      return;
    }

    res.json({
      id: examDoc.id,
      courseCode: data.courseCode || 'N/A',
      courseTitle: data.courseTitle || 'Examination',
      department: data.department || 'All Departments',
      lecturerName: data.lecturerName || 'Not specified',
      durationMinutes: Number(data.durationMinutes) || 30,
      startDate: data.startDate || null,
      endDate: data.endDate || null,
      instructions: data.instructions || 'Answer all questions. Submit before time runs out.',
      status: data.status,
      questionsCount: data.questionsCount || (Array.isArray(data.questions) ? data.questions.length : 0),
      targetQuestionsCount: data.targetQuestionsCount || data.questionsCount || (Array.isArray(data.questions) ? data.questions.length : 0),
      randomizationEnabled: Boolean(data.randomizationEnabled),
      serverTime: now
    });
  } catch (error: any) {
    console.error('Error fetching public exam info:', error);
    res.status(400).json({ error: 'Invalid Exam ID. Please check the ID provided by your lecturer.' });
  }
});

// 3. Start Exam & Verify Duplicate Matric Number
app.post('/api/start-exam', async (req: Request, res: Response): Promise<void> => {
  let lockKey = '';
  try {
    const { examId, fullName, matricNumber, department, gender } = req.body;

    if (!examId || !fullName || !matricNumber || !department) {
      res.status(400).json({ error: 'Please provide all required student details (Full Name, Department, Matriculation Number).' });
      return;
    }

    const cleanExamId = (examId || '').trim();
    const matricVal = validateMatricNumber(matricNumber);
    if (!matricVal.isValid) {
      res.status(400).json({ error: matricVal.error });
      return;
    }
    const normalizedMatric = matricVal.normalized;
    const normalizedFullName = capitalizeProper(fullName);
    const normalizedDept = capitalizeProper(department);

    lockKey = `${cleanExamId}_${normalizedMatric}`;
    if (inFlightRegistrationLocks.has(lockKey)) {
      res.status(409).json({
        error: `A registration/session initialization for matriculation number ${normalizedMatric} is currently being processed. Duplicate simultaneous registrations are prevented.`
      });
      return;
    }
    inFlightRegistrationLocks.add(lockKey);

    const cleanGender = (g: any): string => {
      if (!g) return 'Not recorded';
      const s = String(g).trim().toUpperCase();
      if (s === 'M' || s === 'MALE') return 'M';
      if (s === 'F' || s === 'FEMALE') return 'F';
      return 'Not recorded';
    };
    const resolvedGender = cleanGender(gender);

    // 1. Fetch exam
    const examDoc = await getDoc(doc(db, 'exams', cleanExamId));
    if (!examDoc.exists()) {
      res.status(404).json({ error: 'Invalid Exam ID. Please check the ID provided by your lecturer.' });
      return;
    }

    const examData = examDoc.data();
    if (examData.status !== 'published') {
      res.status(400).json({ error: 'This examination is not open for taking.' });
      return;
    }

    const now = Date.now();
    const access = evaluateExamAccess({
      startDate: examData.startDate,
      endDate: examData.endDate,
      status: examData.status
    }, now);

    if (!access.allowed) {
      res.status(400).json({
        error: access.errorMessage || 'Invalid Exam ID. Please check the ID provided by your lecturer.',
        isClosed: access.status === 'closed',
        notYetOpen: access.status === 'not_yet_open'
      });
      return;
    }

    const closeTimeMs = access.closeTimeMs;

    // Duplicate Check: Check session status for previous submission
    const sessionId = `ses_${cleanExamId}_${normalizedMatric.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const sessionDocRef = doc(db, 'exam_sessions', sessionId);
    const sessionSnap = await getDoc(sessionDocRef);

    if (sessionSnap.exists() && sessionSnap.data()?.status === 'submitted') {
      res.status(400).json({
        error: `Duplicate Registration Error: Candidate with Matriculation Number ${normalizedMatric} has already submitted this examination. Reopening or retaking this examination is strictly prohibited.`,
        alreadySubmitted: true
      });
      return;
    }

    const durationMinutes = Number(examData.durationMinutes) || 30;
    const individualAllowedSeconds = durationMinutes * 60;
    let startedAtIso: string;
    let remainingSeconds: number;
    let assignedBatch = 'Batch A';
    let sessionGender = resolvedGender;

    const batchList = ['Batch A', 'Batch B', 'Batch C', 'Batch D'];

    if (sessionSnap.exists()) {
      const sessionData = sessionSnap.data();
      startedAtIso = sessionData.startedAt;
      assignedBatch = sessionData.batch || 'Batch A';
      sessionGender = sessionData.gender || resolvedGender;
      const startedAtMs = new Date(startedAtIso).getTime();

      // Rule 3: The official closing time must strictly take priority over the individual timer
      const individualExpiresAt = startedAtMs + individualAllowedSeconds * 1000;
      const effectiveExpiresAt = closeTimeMs ? Math.min(individualExpiresAt, closeTimeMs) : individualExpiresAt;
      remainingSeconds = Math.max(0, Math.floor((effectiveExpiresAt - now) / 1000));

      // Rule 5: If student returns after closing time, do not allow them to reopen
      if (remainingSeconds <= 0) {
        // Trigger auto-submit of any existing answers if not already done
        const tracker = timerManager.registerSession({
          sessionId,
          examId: cleanExamId,
          matricNumber: normalizedMatric,
          fullName: normalizedFullName,
          department: normalizedDept,
          gender: sessionGender,
          startedAtIso,
          durationMinutes,
          closingTimeIso: examData.endDate || null,
          closingTimeMs: closeTimeMs,
          courseCode: examData.courseCode,
          courseTitle: examData.courseTitle,
          batch: assignedBatch,
          existingAnswers: sessionData.answers || {}
        });
        await timerManager.executeAutoSubmission(tracker);

        res.status(400).json({
          error: 'This examination has ended. Access is no longer available.',
          isClosed: true
        });
        return;
      }
    } else {
      startedAtIso = new Date().toISOString();
      const startedAtMs = new Date(startedAtIso).getTime();

      // Rule 3: A student who starts shortly before closing time must not continue beyond the official closing time
      const individualExpiresAt = startedAtMs + individualAllowedSeconds * 1000;
      const effectiveExpiresAt = closeTimeMs ? Math.min(individualExpiresAt, closeTimeMs) : individualExpiresAt;
      remainingSeconds = Math.max(0, Math.floor((effectiveExpiresAt - now) / 1000));

      if (remainingSeconds <= 0) {
        res.status(400).json({
          error: 'This examination has ended. Access is no longer available.',
          isClosed: true
        });
        return;
      }

      // Assign student to a batch deterministically or round-robin if randomization is enabled
      if (examData.randomizationEnabled && examData.batches) {
        let hash = 0;
        for (let i = 0; i < normalizedMatric.length; i++) {
          hash = (hash * 31 + normalizedMatric.charCodeAt(i)) % 4;
        }
        assignedBatch = batchList[hash] || 'Batch A';
      }

      await setDoc(sessionDocRef, {
        examId: cleanExamId,
        matricNumber: normalizedMatric,
        fullName: normalizedFullName,
        department: normalizedDept,
        gender: sessionGender,
        startedAt: startedAtIso,
        durationMinutes,
        closingTimeIso: examData.endDate || null,
        expiresAt: effectiveExpiresAt,
        status: 'in_progress',
        batch: assignedBatch
      });

      // Maintain candidate roster on exam record
      try {
        const roster: any[] = Array.isArray(examData.registeredCandidates) ? examData.registeredCandidates : [];
        const isAlreadyInRoster = roster.some(c => (c.matricNumber || '').trim().toUpperCase() === normalizedMatric);
        if (!isAlreadyInRoster) {
          await updateDoc(doc(db, 'exams', cleanExamId), {
            registeredCandidates: [
              ...roster,
              {
                matricNumber: normalizedMatric,
                fullName: normalizedFullName,
                department: normalizedDept,
                gender: sessionGender,
                registeredAt: startedAtIso
              }
            ]
          });
        }
      } catch (rosterErr) {
        console.warn('Could not update exam roster on start-exam:', rosterErr);
      }
    }

    // Register with Server-Side Timer Enforcement Manager (Official closing time priority enforced)
    timerManager.registerSession({
      sessionId,
      examId: cleanExamId,
      matricNumber: normalizedMatric,
      fullName: normalizedFullName,
      department: normalizedDept,
      gender: sessionGender,
      startedAtIso,
      durationMinutes,
      closingTimeIso: examData.endDate || null,
      closingTimeMs: closeTimeMs,
      courseCode: examData.courseCode,
      courseTitle: examData.courseTitle,
      batch: assignedBatch,
      existingAnswers: sessionSnap.exists() ? sessionSnap.data()?.answers : {}
    });

    // 4. Sanitize and organize questions for the assigned batch
    const rawQuestions = Array.isArray(examData.questions) ? examData.questions : [];
    let orderedQuestions = [...rawQuestions];

    if (examData.randomizationEnabled && examData.batches && examData.batches[assignedBatch]) {
      const batchIds = examData.batches[assignedBatch].questionIds;
      if (Array.isArray(batchIds) && batchIds.length > 0) {
        const questionMap = new Map(rawQuestions.map((q: any) => [q.id, q]));
        const batchOrdered: any[] = [];
        batchIds.forEach((id: string) => {
          const q = questionMap.get(id);
          if (q) batchOrdered.push(q);
        });
        rawQuestions.forEach((q: any) => {
          if (!batchIds.includes(q.id)) batchOrdered.push(q);
        });
        orderedQuestions = batchOrdered;
      }
    }

    // Sanitize questions (Strip correctAnswer and explanation)
    const sanitizedQuestions = orderedQuestions.map((q: any, idx: number) => ({
      id: q.id || `q_${idx}`,
      questionText: q.questionText,
      options: q.options
    }));

    const isClosingTimeCapped = Boolean(
      closeTimeMs && closeTimeMs < new Date(startedAtIso).getTime() + individualAllowedSeconds * 1000
    );

    res.json({
      sessionId,
      startedAt: startedAtIso,
      durationMinutes,
      remainingSeconds,
      isClosingTimeCapped,
      closingTimeIso: examData.endDate || null,
      batch: assignedBatch,
      questions: sanitizedQuestions,
      existingAnswers: sessionSnap.exists() ? (sessionSnap.data()?.answers || {}) : {},
      serverTime: now,
      exam: {
        id: examDoc.id,
        courseCode: examData.courseCode,
        courseTitle: examData.courseTitle,
        department: examData.department,
        lecturerName: examData.lecturerName || 'Not specified',
        durationMinutes,
        startDate: examData.startDate,
        endDate: examData.endDate,
        instructions: examData.instructions,
        status: examData.status,
        questionsCount: sanitizedQuestions.length,
        targetQuestionsCount: examData.targetQuestionsCount || sanitizedQuestions.length,
        randomizationEnabled: Boolean(examData.randomizationEnabled)
      }
    });
  } catch (error: any) {
    console.error('Error starting examination:', error);
    res.status(500).json({ error: error?.message || 'Failed to initialize examination session.' });
  } finally {
    if (lockKey) {
      inFlightRegistrationLocks.delete(lockKey);
    }
  }
});

// 4. Real-time Answers Progress Save & Server Timer Check
app.post('/api/save-progress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, examId, matricNumber, answers = {} } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID.' });
      return;
    }

    // Update in-memory tracker
    timerManager.updateAnswers(sessionId, answers);

    // Check timer status authoritatively on the server (considering closing time)
    let timeStatus = timerManager.getRemainingTime(sessionId);

    // If tracker not in memory (e.g. server restart), restore from Firestore
    if (timeStatus.status === 'not_found') {
      const sessionSnap = await getDoc(doc(db, 'exam_sessions', sessionId));
      if (sessionSnap.exists()) {
        const data = sessionSnap.data();
        let closingTimeIso = data.closingTimeIso;
        if (!closingTimeIso && data.examId) {
          const eDoc = await getDoc(doc(db, 'exams', data.examId));
          if (eDoc.exists()) closingTimeIso = eDoc.data().endDate;
        }

        timerManager.registerSession({
          sessionId,
          examId: data.examId,
          matricNumber: data.matricNumber,
          fullName: data.fullName,
          department: data.department,
          gender: data.gender || 'Not recorded',
          startedAtIso: data.startedAt,
          durationMinutes: data.durationMinutes,
          closingTimeIso,
          existingAnswers: answers
        });
        timeStatus = timerManager.getRemainingTime(sessionId);
      }
    }

    // Rule 4: If a student is still writing when official closing time arrives, automatically submit saved answers
    if (timeStatus.isExpired) {
      const tracker = timerManager.getSession(sessionId);
      if (tracker && tracker.status !== 'submitted') {
        tracker.answers = { ...tracker.answers, ...answers };
        const autoResult = await timerManager.executeAutoSubmission(tracker);
        if (autoResult) {
          res.json({
            isExpired: true,
            autoSubmitted: true,
            message: 'This examination has ended. Access is no longer available.',
            submissionReceipt: autoResult.submissionReceipt,
            submittedAt: autoResult.submittedAt,
            fullName: autoResult.fullName,
            matricNumber: autoResult.matricNumber,
            courseCode: autoResult.courseCode,
            courseTitle: autoResult.courseTitle,
            lecturerName: autoResult.lecturerName || 'Not specified',
            totalQuestions: autoResult.totalQuestions
          });
          return;
        }
      }

      res.json({
        isExpired: true,
        autoSubmitted: true,
        remainingSeconds: 0,
        message: 'This examination has ended. Access is no longer available.',
        serverTime: Date.now()
      });
      return;
    }

    // Persist answers to Firestore session document regularly
    try {
      await updateDoc(doc(db, 'exam_sessions', sessionId), {
        answers,
        lastSavedAt: new Date().toISOString()
      });
    } catch (saveErr) {
      console.warn('[Timer Enforcement] Could not sync answers to Firestore session:', saveErr);
    }

    res.json({
      success: true,
      isExpired: false,
      remainingSeconds: timeStatus.remainingSeconds,
      serverTime: timeStatus.serverTime,
      isClosingTimeEnforced: timeStatus.isClosingTimeEnforced
    });
  } catch (error: any) {
    console.error('Error saving progress:', error);
    res.status(500).json({ error: 'Failed to record candidate progress.' });
  }
});

// 5. Query Server Time & Session Time Remaining
app.get('/api/session-time/:sessionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    let timeStatus = timerManager.getRemainingTime(sessionId);

    if (timeStatus.status === 'not_found') {
      // Check if session exists in Firestore
      const sessionSnap = await getDoc(doc(db, 'exam_sessions', sessionId));
      if (!sessionSnap.exists()) {
        res.status(404).json({ error: 'Session not found.' });
        return;
      }
      const data = sessionSnap.data();

      // Look up exam to get latest closing time
      let closingTimeIso = data.closingTimeIso;
      if (data.examId) {
        const eDoc = await getDoc(doc(db, 'exams', data.examId));
        if (eDoc.exists()) closingTimeIso = eDoc.data().endDate;
      }

      const tracker = timerManager.registerSession({
        sessionId,
        examId: data.examId,
        matricNumber: data.matricNumber,
        fullName: data.fullName,
        department: data.department,
        gender: data.gender || 'Not recorded',
        startedAtIso: data.startedAt,
        durationMinutes: data.durationMinutes,
        closingTimeIso,
        existingAnswers: data.answers || {}
      });
      timeStatus = timerManager.getRemainingTime(sessionId);

      // If expired upon restoration (e.g. candidate reconnects after closing time)
      if (timeStatus.isExpired && tracker.status !== 'submitted') {
        await timerManager.executeAutoSubmission(tracker);
      }
    }

    // If session is expired or already submitted
    if (timeStatus.isExpired) {
      res.json({
        ...timeStatus,
        remainingSeconds: 0,
        isExpired: true,
        message: 'This examination has ended. Access is no longer available.'
      });
      return;
    }

    res.json(timeStatus);
  } catch (error: any) {
    console.error('Error fetching session time:', error);
    res.status(500).json({ error: 'Failed to verify session time.' });
  }
});

// 6. Explicit Auto-Submit on Client Countdown Expiration
app.post('/api/auto-submit', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, examId, matricNumber, answers = {} } = req.body;
    const targetSessionId = sessionId || `ses_${examId}_${matricNumber?.replace(/[^a-zA-Z0-9]/g, '_')}`;

    let tracker = timerManager.getSession(targetSessionId);
    if (!tracker) {
      const sessionSnap = await getDoc(doc(db, 'exam_sessions', targetSessionId));
      if (sessionSnap.exists()) {
        const data = sessionSnap.data();
        let closingTimeIso = data.closingTimeIso;
        if (data.examId) {
          const eDoc = await getDoc(doc(db, 'exams', data.examId));
          if (eDoc.exists()) closingTimeIso = eDoc.data().endDate;
        }

        tracker = timerManager.registerSession({
          sessionId: targetSessionId,
          examId: data.examId,
          matricNumber: data.matricNumber,
          fullName: data.fullName,
          department: data.department,
          gender: data.gender || 'Not recorded',
          startedAtIso: data.startedAt,
          durationMinutes: data.durationMinutes,
          closingTimeIso,
          existingAnswers: answers
        });
      }
    }

    if (!tracker) {
      res.status(404).json({ error: 'Active session not found for auto-submit.' });
      return;
    }

    tracker.answers = { ...tracker.answers, ...answers };
    const result = await timerManager.executeAutoSubmission(tracker);

    if (result) {
      res.json(result);
    } else {
      res.status(400).json({ error: 'Examination was already submitted.' });
    }
  } catch (error: any) {
    console.error('Error executing auto-submit:', error);
    res.status(500).json({ error: 'Failed to complete automatic submission.' });
  }
});

// 4. Submit Exam & Automated Server-Side Grading
app.post('/api/submit-exam', async (req: Request, res: Response): Promise<void> => {
  const { examId, sessionId, fullName, matricNumber, department, gender, answers = {} } = req.body;

  if (!examId || !matricNumber || !fullName || !department) {
    res.status(400).json({ error: 'Missing candidate details for examination submission.' });
    return;
  }

  // Strict matriculation format validation
  const matricVal = validateMatricNumber(matricNumber);
  if (!matricVal.isValid) {
    res.status(400).json({ error: matricVal.error });
    return;
  }
  const normalizedMatric = matricVal.normalized;
  const lockKey = `${examId}_${normalizedMatric}`;

  // Simultaneous submission lock protection
  if (inFlightSubmissionLocks.has(lockKey)) {
    res.status(409).json({
      error: 'A submission for this matriculation number is already currently being processed. Duplicate simultaneous submissions are rejected.'
    });
    return;
  }
  inFlightSubmissionLocks.add(lockKey);

  try {
    // 1. Fetch official exam with answer keys
    const examDoc = await getDoc(doc(db, 'exams', examId));
    if (!examDoc.exists()) {
      res.status(404).json({ error: 'Examination record not found.' });
      return;
    }
    const examData = examDoc.data();

    // 2. Duplicate Check: Check session status and previous submissions for this exam
    const deterministicSessionId = sessionId || `ses_${examId}_${normalizedMatric.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const sessionSnap = await getDoc(doc(db, 'exam_sessions', deterministicSessionId));
    if (sessionSnap.exists() && sessionSnap.data().status === 'submitted') {
      res.status(400).json({
        error: `Duplicate Submission Error: Candidate with Matriculation Number ${normalizedMatric} has already submitted this examination.`,
        alreadySubmitted: true
      });
      return;
    }

    // 4. Resolve exact question order presented to the candidate
    const assignedBatch = (sessionSnap.exists() && sessionSnap.data()?.batch) || 'Batch A';
    const rawQuestions = Array.isArray(examData.questions) ? examData.questions : [];
    let orderedQuestions = [...rawQuestions];

    if (examData.randomizationEnabled && examData.batches && examData.batches[assignedBatch]) {
      const batchIds = examData.batches[assignedBatch].questionIds;
      if (Array.isArray(batchIds) && batchIds.length > 0) {
        const questionMap = new Map(rawQuestions.map((q: any) => [q.id, q]));
        const batchOrdered: any[] = [];
        batchIds.forEach((id: string) => {
          const q = questionMap.get(id);
          if (q) batchOrdered.push(q);
        });
        rawQuestions.forEach((q: any) => {
          if (!batchIds.includes(q.id)) batchOrdered.push(q);
        });
        orderedQuestions = batchOrdered;
      }
    }

    // 5. Build immutable question snapshot preserving exact text, options, order and correct answers
    const questionSnapshot = orderedQuestions.map((q: any, idx: number) => ({
      id: q.id || `q_${idx}`,
      questionNumber: idx + 1,
      questionText: q.questionText || '',
      options: Array.isArray(q.options) ? q.options : [],
      correctAnswer: typeof q.correctAnswer === 'number' ? q.correctAnswer : 0,
      isTrueFalse: Boolean(
        (q.options && q.options.length === 2 && (q.options[0].toLowerCase() === 'true')) ||
        q.isTrueFalse
      )
    }));

    let score = 0;
    let attemptedCount = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;
    const totalQuestions = orderedQuestions.length;

    orderedQuestions.forEach((q: any, idx: number) => {
      const qKey = q.id || `q_${idx}`;
      const candidateChoice = answers[qKey];
      const isUnanswered = candidateChoice === undefined || candidateChoice === null || Number(candidateChoice) < 0 || isNaN(Number(candidateChoice));
      if (isUnanswered) {
        unansweredCount += 1;
      } else {
        attemptedCount += 1;
        if (isAnswerCorrect(candidateChoice, q.correctAnswer, q.options || [])) {
          score += 1;
          correctCount += 1;
        } else {
          incorrectCount += 1;
        }
      }
    });

    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
    const submissionId = `sub_${examId}_${normalizedMatric.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    const submissionReceipt = `SUN-CBT-${Math.random().toString(36).substring(2, 7).toUpperCase()}-${Date.now().toString().slice(-4)}`;
    const submittedAt = new Date().toISOString();
    const rawGender = gender || (sessionSnap.exists() && sessionSnap.data()?.gender);
    const resolvedGender = (rawGender === 'M' || String(rawGender).trim().toUpperCase() === 'M' || String(rawGender).trim().toUpperCase() === 'MALE')
      ? 'M'
      : (rawGender === 'F' || String(rawGender).trim().toUpperCase() === 'F' || String(rawGender).trim().toUpperCase() === 'FEMALE')
      ? 'F'
      : 'Not recorded';

    // Normalize and auto-capitalize personal details
    const cleanedFullName = capitalizeProper(fullName);
    const cleanedDepartment = capitalizeProper(department);

    // 6. Store submission securely in Firestore with immutable question snapshot and performance metrics
    await setDoc(doc(db, 'submissions', submissionId), {
      examId,
      lecturerId: examData.lecturerId || 'central_examiner',
      lecturerName: examData.lecturerName || 'Not specified',
      fullName: cleanedFullName,
      matricNumber: normalizedMatric,
      department: cleanedDepartment,
      gender: resolvedGender,
      courseCode: examData.courseCode,
      courseTitle: examData.courseTitle,
      score,
      totalQuestions,
      percentage,
      attemptedCount,
      unansweredCount,
      correctCount,
      incorrectCount,
      submittedAt,
      submissionReceipt,
      batch: assignedBatch,
      answers,
      questionSnapshot
    });

    // 6. Update session status
    timerManager.markCompleted(deterministicSessionId);
    if (deterministicSessionId) {
      try {
        await updateDoc(doc(db, 'exam_sessions', deterministicSessionId), {
          status: 'submitted',
          answers
        });
      } catch (err) {
        console.warn('Could not update session doc:', err);
      }
    }

    // 7. Return response to student (WITHOUT SCORES OR CORRECT ANSWERS)
    res.json({
      success: true,
      submissionReceipt,
      submittedAt,
      fullName: cleanedFullName,
      matricNumber: normalizedMatric,
      courseCode: examData.courseCode,
      courseTitle: examData.courseTitle,
      lecturerName: examData.lecturerName || 'Not specified',
      totalQuestions
    });
  } catch (error: any) {
    console.error('Error submitting exam:', error);
    res.status(500).json({ error: error?.message || 'Failed to record examination submission.' });
  } finally {
    inFlightSubmissionLocks.delete(lockKey);
  }
});

// 5. Batch Candidate Registration & Duplicate Detection Endpoint
app.post('/api/validate-candidate-batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const { candidates, examId } = req.body;

    if (!Array.isArray(candidates)) {
      res.status(400).json({ error: 'candidates must be an array.' });
      return;
    }

    const existingMatrics = new Set<string>();
    if (examId) {
      try {
        const examDoc = await getDoc(doc(db, 'exams', examId));
        if (examDoc.exists()) {
          const eData = examDoc.data();
          const roster: any[] = Array.isArray(eData.registeredCandidates) ? eData.registeredCandidates : [];
          roster.forEach((c: any) => {
            if (c.matricNumber) existingMatrics.add(String(c.matricNumber).trim().toUpperCase());
          });
        }
      } catch (err) {
        console.warn('Could not read existing exam roster:', err);
      }
    }

    const report = validateAndReportCandidateBatch(candidates, existingMatrics);

    // Also check if any candidate in validCandidates has already submitted an exam session
    if (examId && report.validCandidates.length > 0) {
      const alreadySubmitted: string[] = [];
      for (const cand of report.validCandidates) {
        const sesId = `ses_${examId}_${cand.matricNumber.replace(/[^a-zA-Z0-9]/g, '_')}`;
        try {
          const sSnap = await getDoc(doc(db, 'exam_sessions', sesId));
          if (sSnap.exists() && sSnap.data()?.status === 'submitted') {
            alreadySubmitted.push(cand.matricNumber);
          }
        } catch {}
      }

      if (alreadySubmitted.length > 0) {
        alreadySubmitted.forEach(m => report.rejectedEntries.alreadyRegistered.push(m));
        report.validCandidates = report.validCandidates.filter(c => !alreadySubmitted.includes(c.matricNumber));
        report.summary.validCount = report.validCandidates.length;
        report.summary.rejectedCount += alreadySubmitted.length;
        report.valid = false;
        report.reportMessage += `\n• Already submitted this examination (${alreadySubmitted.length}): ${alreadySubmitted.join(', ')}`;
      }
    }

    if (!report.valid) {
      res.status(400).json({
        valid: false,
        summary: report.summary,
        error: report.reportMessage,
        rejectedEntries: report.rejectedEntries,
        validCandidates: report.validCandidates
      });
      return;
    }

    res.json({
      valid: true,
      summary: report.summary,
      message: report.reportMessage,
      validCandidates: report.validCandidates
    });
  } catch (error: any) {
    console.error('Error validating candidate batch:', error);
    res.status(500).json({ error: 'Failed to validate candidate batch.' });
  }
});

// API 404 Handler (ensures unknown API endpoints return JSON instead of HTML)
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Vite integration / Static serving
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SUN CBT] Server active in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode on port ${PORT}`);
    console.log(`[SUN CBT] Accessible at http://0.0.0.0:${PORT}`);
  });
}

startServer();
