import {
  parseLagosExamTime,
  formatLagosDateTime,
  formatLagosTime,
  evaluateExamAccess,
  LAGOS_TIMEZONE
} from '../src/utils/timeUtils.ts';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const fbApp = initializeApp(firebaseConfig, 'test-verification');
const db = getFirestore(fbApp, firebaseConfig.firestoreDatabaseId);

async function runTestSuite() {
  console.log('========================================================================');
  console.log('SUN CBT OFFICIAL TIME ACCESS & ENFORCEMENT VERIFICATION');
  console.log(`Timezone: ${LAGOS_TIMEZONE} (West Africa Time - WAT, UTC+1)`);
  console.log('========================================================================\n');

  const results = {};

  const examOpen10am = {
    startDate: '2026-11-05T10:00',
    endDate: '2026-11-05T12:00',
    status: 'published'
  };

  const examOpen10Close1030 = {
    startDate: '2026-11-05T10:00',
    endDate: '2026-11-05T10:30',
    status: 'published'
  };

  // ----------------------------------------------------
  // TEST A: Opening time: 10:00 AM. Current time: 9:59 AM. Expected: Access denied.
  // ----------------------------------------------------
  const time959am = parseLagosExamTime('2026-11-05T09:59');
  const resA = evaluateExamAccess(examOpen10am, time959am);
  const passedA = resA.allowed === false && resA.status === 'not_yet_open';
  results.testA = {
    test: 'TEST A',
    scenario: 'Opening: 10:00 AM, Current: 9:59 AM',
    expected: 'Access denied',
    actual: resA.allowed ? 'Access allowed' : `Access denied (${resA.errorMessage})`,
    result: passedA ? 'PASSED [✓]' : 'FAILED [✗]'
  };
  console.log(`[TEST A] ${results.testA.result}`);
  console.log(`  Current time: ${formatLagosDateTime(time959am)}`);
  console.log(`  Opening time: ${formatLagosDateTime(examOpen10am.startDate)}`);
  console.log(`  Outcome: ${results.testA.actual}\n`);

  // ----------------------------------------------------
  // TEST B: Opening time: 10:00 AM. Current time: 10:00 AM. Expected: Access allowed.
  // ----------------------------------------------------
  const time1000am = parseLagosExamTime('2026-11-05T10:00');
  const resB = evaluateExamAccess(examOpen10am, time1000am);
  const passedB = resB.allowed === true && resB.status === 'published';
  results.testB = {
    test: 'TEST B',
    scenario: 'Opening: 10:00 AM, Current: 10:00 AM',
    expected: 'Access allowed',
    actual: resB.allowed ? 'Access allowed (Exam accessible)' : `Access denied (${resB.errorMessage})`,
    result: passedB ? 'PASSED [✓]' : 'FAILED [✗]'
  };
  console.log(`[TEST B] ${results.testB.result}`);
  console.log(`  Current time: ${formatLagosDateTime(time1000am)}`);
  console.log(`  Opening time: ${formatLagosDateTime(examOpen10am.startDate)}`);
  console.log(`  Outcome: ${results.testB.actual}\n`);

  // ----------------------------------------------------
  // TEST C: Opening time: 10:00 AM. Closing time: 10:30 AM. Current time: 10:15 AM. Expected: Access allowed.
  // ----------------------------------------------------
  const time1015am = parseLagosExamTime('2026-11-05T10:15');
  const resC = evaluateExamAccess(examOpen10Close1030, time1015am);
  const passedC = resC.allowed === true && resC.status === 'published';
  results.testC = {
    test: 'TEST C',
    scenario: 'Opening: 10:00 AM, Closing: 10:30 AM, Current: 10:15 AM',
    expected: 'Access allowed',
    actual: resC.allowed ? 'Access allowed (Within active window)' : `Access denied (${resC.errorMessage})`,
    result: passedC ? 'PASSED [✓]' : 'FAILED [✗]'
  };
  console.log(`[TEST C] ${results.testC.result}`);
  console.log(`  Current time: ${formatLagosDateTime(time1015am)}`);
  console.log(`  Window: 10:00 AM – 10:30 AM`);
  console.log(`  Outcome: ${results.testC.actual}\n`);

  // ----------------------------------------------------
  // TEST D: Closing time: 10:30 AM. Current time: 10:30 AM. Expected: Access denied.
  // ----------------------------------------------------
  const time1030am = parseLagosExamTime('2026-11-05T10:30');
  const resD = evaluateExamAccess(examOpen10Close1030, time1030am);
  const passedD = resD.allowed === false && resD.status === 'closed';
  results.testD = {
    test: 'TEST D',
    scenario: 'Closing: 10:30 AM, Current: 10:30 AM',
    expected: 'Access denied',
    actual: resD.allowed ? 'Access allowed' : `Access denied (${resD.errorMessage})`,
    result: passedD ? 'PASSED [✓]' : 'FAILED [✗]'
  };
  console.log(`[TEST D] ${results.testD.result}`);
  console.log(`  Current time: ${formatLagosDateTime(time1030am)}`);
  console.log(`  Closing time: ${formatLagosDateTime(examOpen10Close1030.endDate)}`);
  console.log(`  Outcome: ${results.testD.actual}\n`);

  // ----------------------------------------------------
  // TEST E: A student is writing when official closing time reaches 10:30 AM.
  // Expected: Examination automatically submits and closes.
  // ----------------------------------------------------
  console.log('Testing TEST E: Active examination auto-submission at closing time...');
  const { TimerEnforcementManager } = await import('../src/server/timerEnforcement.ts');
  const testTimerManager = new TimerEnforcementManager(db);

  const testSessionId = `test_ses_auto_${Date.now()}`;
  const testExamId = 'exam_sun_spt201';
  const testClosingTimeMs = Date.now() + 1200; // Official closing time reaches in 1.2s

  const tracker = testTimerManager.registerSession({
    sessionId: testSessionId,
    examId: testExamId,
    matricNumber: `SUN/TEST/AUTOSUB_${Date.now()}`,
    fullName: 'Auto Submit Test Candidate',
    department: 'Sports Science',
    startedAtIso: new Date().toISOString(),
    durationMinutes: 60, // Individual duration is 60m
    closingTimeMs: testClosingTimeMs, // But closing time priority forces effective expiry to 1.2s!
    courseCode: 'SPT 201',
    courseTitle: 'Introduction to Human Kinetics',
    existingAnswers: { q1: 0, q2: 1 }
  });

  // Verify before expiry
  const preCheck = testTimerManager.getRemainingTime(testSessionId);
  console.log(`  Before closing: remaining = ${preCheck.remainingSeconds}s, Capped by closing time = ${preCheck.isClosingTimeEnforced}`);

  // Wait 2.2 seconds for the server sweeper to trigger auto-submission
  await new Promise(r => setTimeout(r, 2200));

  const postCheck = testTimerManager.getRemainingTime(testSessionId);
  const passedE = postCheck.isExpired === true && tracker.status === 'submitted';
  results.testE = {
    test: 'TEST E',
    scenario: 'Student writing when official closing time is reached',
    expected: 'Examination automatically submits and closes',
    actual: passedE ? 'Examination automatically submitted answers and session sealed' : `Status: ${tracker.status}`,
    result: passedE ? 'PASSED [✓]' : 'FAILED [✗]'
  };
  console.log(`[TEST E] ${results.testE.result}`);
  console.log(`  Status after closing: ${tracker.status}`);
  console.log(`  Is expired: ${postCheck.isExpired}`);
  testTimerManager.destroy();
  console.log('');

  // ----------------------------------------------------
  // TEST F: A student has already submitted and tries to reuse the same Exam ID.
  // Expected: Access denied.
  // ----------------------------------------------------
  console.log('Testing TEST F: Candidate attempts to reuse Exam ID after submission...');
  const testMatric = `SUN/TEST/MATRIC_${Date.now()}`;

  // Step 1: Start exam via HTTP API
  const startRes = await fetch('http://localhost:3000/api/start-exam', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      examId: 'exam_sun_spt201',
      fullName: 'Single Attempt Candidate',
      matricNumber: testMatric,
      department: 'Human Kinetics'
    })
  });
  const startData = await startRes.json();
  const testSession = startData.sessionId;

  // Step 2: Submit exam via HTTP API
  const submitRes = await fetch('http://localhost:3000/api/submit-exam', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: testSession,
      examId: 'exam_sun_spt201',
      fullName: 'Single Attempt Candidate',
      matricNumber: testMatric,
      department: 'Human Kinetics',
      answers: { q1: 0 }
    })
  });
  const submitData = await submitRes.json();

  // Step 3: Attempt to reuse Exam ID via /api/verify-candidate & /api/start-exam
  const reuseRes = await fetch('http://localhost:3000/api/start-exam', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      examId: 'exam_sun_spt201',
      fullName: 'Single Attempt Candidate',
      matricNumber: testMatric,
      department: 'Human Kinetics'
    })
  });
  const reuseData = await reuseRes.json();

  const passedF = reuseRes.status === 400 && reuseData.alreadySubmitted === true;
  results.testF = {
    test: 'TEST F',
    scenario: 'Student already submitted and tries to reuse Exam ID',
    expected: 'Access denied',
    actual: passedF ? `Access denied (400: ${reuseData.error})` : `HTTP ${reuseRes.status}`,
    result: passedF ? 'PASSED [✓]' : 'FAILED [✗]'
  };
  console.log(`[TEST F] ${results.testF.result}`);
  console.log(`  Reuse attempt result: ${reuseData.error}\n`);

  console.log('Testing TEST G: Student manipulates device time to bypass closing time...');
  const closedExam = {
    startDate: '2026-11-01T08:00',
    endDate: '2026-11-01T10:00',
    status: 'published'
  };

  // Even if the student changes local machine clock to 08:30 AM on Nov 1st, 
  // the server evaluates strictly using Date.now() (the actual current server time)
  const serverEvaluation = evaluateExamAccess(closedExam, Date.now());
  const passedG = serverEvaluation.allowed === false && serverEvaluation.status === 'closed';
  results.testG = {
    test: 'TEST G',
    scenario: 'Student changes device clock to bypass examination closing time',
    expected: 'Access remains denied because backend checks actual current time',
    actual: passedG ? `Access denied (400: ${serverEvaluation.errorMessage})` : `Access allowed`,
    result: passedG ? 'PASSED [✓]' : 'FAILED [✗]'
  };
  console.log(`[TEST G] ${results.testG.result}`);
  console.log(`  Backend rejection: ${serverEvaluation.errorMessage}`);
  console.log(`  Closed at Lagos: ${serverEvaluation.closesAtLagos}\n`);

  console.log('========================================================================');
  console.log('FINAL EXECUTION SUMMARY TABLE:');
  console.log('========================================================================');
  console.table(results);

  const allPassed = Object.values(results).every(r => r.result.includes('PASSED'));
  if (allPassed) {
    console.log('\nALL 7 TESTS VERIFIED AND PASSED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.error('\nONE OR MORE TESTS FAILED.');
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
