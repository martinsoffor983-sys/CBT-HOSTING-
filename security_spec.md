# Security Specification for SUN CBT

## 1. Data Invariants

1. **Lecturer Exam Isolation**: Only authenticated lecturers can create, update, or read their own full examinations (`request.auth.uid == resource.data.lecturerId`).
2. **Student Answer Protection**: Students must never read the answer keys or full exam documents directly from Firestore. Student interaction is mediated by the server API which strips correct answers.
3. **Submission Confidentiality**: Students must never read submissions, scores, or other candidates' data. Only the lecturer who created the examination can list and read the submissions for their exam (`request.auth.uid == resource.data.lecturerId`).
4. **Submission Immutability**: Once an exam submission is recorded, it cannot be modified or tampered with by any student.
5. **Session Locking**: Exam sessions prevent duplicate entries for the same matriculation number on the same examination.

---

## 2. The "Dirty Dozen" Threat Payloads (Must be Denied)

1. **Anonymous Exam Read**: An unauthenticated client attempting `get` on `/exams/{examId}` to steal questions and answer keys.
2. **Student Answer Key Scrape**: An unauthenticated client attempting `list` on `/exams` to harvest exams.
3. **Lecturer Impersonation on Create**: An attacker submitting `lecturerId: "other_uid"` to hijack exam ownership.
4. **Ghost Field Injection**: Adding an unpermitted field `overrideMaxScore: 1000` to an exam document.
5. **Unauthorized Exam Update**: Lecturer A attempting to update an exam owned by Lecturer B.
6. **Unauthorized Exam Deletion**: Lecturer A attempting to delete an exam owned by Lecturer B.
7. **Public Submissions Scraping**: A student attempting `list` on `/submissions` to view classmate grades.
8. **Student Score Self-Assignment**: A student writing a submission document with arbitrary `score: 100`.
9. **Tampering with Submitted Exam**: Attempting an `update` on an existing submission document to modify answers or scores.
10. **Session Hijacking**: Attempting to alter `startedAt` in `/exam_sessions/{sessionId}` to bypass the exam timer.
11. **Malicious ID Injection**: A path variable longer than 128 characters or containing invalid characters (`../../etc/passwd`).
12. **Submission Cross-Lecturer Access**: Lecturer A attempting to read candidate submissions for an exam belonging to Lecturer B.

---

## 3. Test Runner Design (`firestore.rules.test.ts`)

The rules enforce:
- Default deny on all unmatched paths.
- Exams read/write restricted to authenticated owner lecturer (`request.auth.uid == resource.data.lecturerId`).
- Submissions read restricted to authenticated owner lecturer (`request.auth.uid == resource.data.lecturerId`).
- Submissions create/update restricted from unauthorized client tampering.
- Path parameter validation using `isValidId()`.
