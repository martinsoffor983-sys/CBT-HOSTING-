import fs from 'fs';
import path from 'path';
import { exportIndividualScriptToWord } from '../src/utils/exportUtils';
import { Exam, Submission } from '../src/types';

// Mock base examination
const sampleExam: Exam = {
  id: 'SUN-EXAM-TEST-001',
  lecturerId: 'prof_okafor_01',
  lecturerEmail: 'sunsmartcbt@gmail.com',
  lecturerName: 'Prof. Chidi Kenneth Okafor',
  courseCode: 'GST 111',
  courseTitle: 'Communication in English & Academic Writing',
  department: 'All Departments',
  durationMinutes: 45,
  startDate: '2026-11-10T09:00:00.000Z',
  endDate: '2026-11-10T12:00:00.000Z',
  instructions: 'Answer all questions carefully.',
  status: 'published',
  questionsCount: 8,
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z'
};

const sampleQuestions = [
  {
    id: 'q1',
    questionNumber: 1,
    questionText: 'Which of the following describes the grammatical function of a subject in a standard declarative sentence?',
    options: [
      'It performs the action or is the topic of the sentence',
      'It modifies the primary verb phrase',
      'It terminates the predicate clause',
      'It connects subordinate adverbials'
    ],
    correctAnswer: 0
  },
  {
    id: 'q2',
    questionNumber: 2,
    questionText: 'Identify the option that correctly represents a compound-complex sentence structure.',
    options: [
      'The whistle blew, and the athletes began running while the spectators cheered loudly.',
      'The athletes ran across the stadium.',
      'Cheering loudly in the stands.',
      'Although the whistle blew.'
    ],
    correctAnswer: 0
  },
  {
    id: 'q3',
    questionNumber: 3,
    questionText: 'Academic writing strictly requires the avoidance of colloquialisms and informal contractions.',
    options: ['True', 'False'],
    correctAnswer: 0,
    isTrueFalse: true
  },
  {
    id: 'q4',
    questionNumber: 4,
    questionText: 'A bibliography and a reference list serve the exact same bibliographic scope in APA 7th edition formatting.',
    options: ['True', 'False'],
    correctAnswer: 1,
    isTrueFalse: true
  },
  {
    id: 'q5',
    questionNumber: 5,
    questionText: 'Which rhetorical device relies primarily on the repetition of initial consonant sounds in successive syllables?',
    options: [
      'Alliteration',
      'Metonymy',
      'Hyperbole',
      'Synecdoche'
    ],
    correctAnswer: 0
  },
  {
    id: 'q6',
    questionNumber: 6,
    questionText: 'Select the sentence that adheres strictly to standard Subject-Verb Agreement rules.',
    options: [
      'Neither the coach nor the team members was ready.',
      'Neither the coach nor the team members were ready.',
      'Each of the students have submitted their assignment.',
      'The committee have reached an impasse.'
    ],
    correctAnswer: 1
  },
  {
    id: 'q7',
    questionNumber: 7,
    questionText: 'In sports biomechanics research papers, the acronym "VO2 max" specifically quantifies:',
    options: [
      'Maximum volume of oxygen uptake during incremental exercise',
      'Ventilatory output during anaerobic acceleration',
      'Velocity over second-stage exertion',
      'Viscosity index of lactic bloodstream accumulation'
    ],
    correctAnswer: 0
  },
  {
    id: 'q8',
    questionNumber: 8,
    questionText: 'Plagiarism includes both direct copying and unacknowledged paraphrasing of intellectual property.',
    options: ['True', 'False'],
    correctAnswer: 0,
    isTrueFalse: true
  }
];

// Test Cases
const testCases: { name: string; filename: string; sub: Submission }[] = [
  // 1. Correct and incorrect answers
  {
    name: 'Student with Correct & Incorrect Answers',
    filename: 'test_script_1_mixed.docx',
    sub: {
      id: 'sub_001',
      examId: 'SUN-EXAM-TEST-001',
      lecturerId: 'prof_okafor_01',
      lecturerName: 'Prof. Chidi Kenneth Okafor',
      fullName: 'emeka chukwuemeka okonkwo',
      matricNumber: '2026201120',
      department: 'human kinetics & sports science',
      gender: 'M',
      courseCode: 'GST 111',
      courseTitle: 'Communication in English & Academic Writing',
      score: 6,
      totalQuestions: 8,
      percentage: 75.0,
      submittedAt: '2026-11-10T09:42:15.000Z',
      submissionReceipt: 'SUN-CBT-782910-WAT',
      batch: 'Batch A',
      answers: {
        q1: 0, // correct
        q2: 1, // incorrect (selected 1, correct 0)
        q3: 0, // correct (True)
        q4: 1, // correct (False)
        q5: 2, // incorrect (selected 2, correct 0)
        q6: 1, // correct
        q7: 0, // correct
        q8: 0  // correct
      },
      questionSnapshot: sampleQuestions
    }
  },
  // 2. Student with unanswered questions
  {
    name: 'Student with Unanswered Questions',
    filename: 'test_script_2_unanswered.docx',
    sub: {
      id: 'sub_002',
      examId: 'SUN-EXAM-TEST-001',
      lecturerId: 'prof_okafor_01',
      lecturerName: 'Prof. Chidi Kenneth Okafor',
      fullName: 'fatima zainab abubakar',
      matricNumber: 'DE2026203344',
      department: 'nursing science',
      gender: 'F',
      courseCode: 'GST 111',
      score: 3,
      totalQuestions: 8,
      percentage: 37.5,
      submittedAt: '2026-11-10T09:35:00.000Z',
      submissionReceipt: 'SUN-CBT-991203-WAT',
      batch: 'Batch B',
      answers: {
        q1: 0, // correct
        q2: 0, // correct
        q3: 0, // correct
        q4: -1, // UNANSWERED
        q5: -1, // UNANSWERED
        q6: 0, // incorrect
        // q7 omitted (unanswered)
        // q8 omitted (unanswered)
      },
      questionSnapshot: sampleQuestions
    }
  },
  // 3. True/False heavy & historical record without lecturer name
  {
    name: 'Student with True/False questions & Historical Record',
    filename: 'test_script_3_true_false.docx',
    sub: {
      id: 'sub_003',
      examId: 'SUN-EXAM-TEST-001',
      lecturerId: 'prof_okafor_01',
      fullName: 'blessing chidinma nwosu',
      matricNumber: '2026208899',
      department: 'sports management & administration',
      gender: 'F',
      courseCode: 'GST 111',
      score: 7,
      totalQuestions: 8,
      percentage: 87.5,
      submittedAt: '2026-11-10T09:28:44.000Z',
      submissionReceipt: 'SUN-CBT-338821-WAT',
      batch: 'Batch A',
      answers: {
        q1: 0,
        q2: 0,
        q3: 0, // True (correct)
        q4: 1, // False (correct)
        q5: 0,
        q6: 1,
        q7: 0,
        q8: 1 // False (incorrect, correct was True)
      },
      questionSnapshot: sampleQuestions
    }
  },
  // 4. Student with long name and department
  {
    name: 'Student with Long Name & Long Department',
    filename: 'test_script_4_long_name.docx',
    sub: {
      id: 'sub_004',
      examId: 'SUN-EXAM-TEST-001',
      lecturerId: 'prof_okafor_01',
      lecturerName: 'Prof. Chidi Kenneth Okafor',
      fullName: 'alexander chukwuemeka ogbonna-nwachukwu the third',
      matricNumber: 'DE2026207711',
      department: 'department of physiotherapy, rehabilitation & sports orthopaedic sciences',
      gender: 'M',
      courseCode: 'GST 111',
      score: 8,
      totalQuestions: 8,
      percentage: 100.0,
      submittedAt: '2026-11-10T09:50:12.000Z',
      submissionReceipt: 'SUN-CBT-445566-WAT',
      batch: 'Batch C',
      answers: {
        q1: 0,
        q2: 0,
        q3: 0,
        q4: 1,
        q5: 0,
        q6: 1,
        q7: 0,
        q8: 0
      },
      questionSnapshot: sampleQuestions
    }
  },
  // 5. Multi-page report (16 questions)
  {
    name: 'Multi-Page Script Report',
    filename: 'test_script_5_multipage.docx',
    sub: {
      id: 'sub_005',
      examId: 'SUN-EXAM-TEST-001',
      lecturerId: 'prof_okafor_01',
      lecturerName: 'Prof. Chidi Kenneth Okafor',
      fullName: 'kenechukwu daniel oluwaseun',
      matricNumber: '2026204455',
      department: 'computer science & sports analytics',
      gender: 'M',
      courseCode: 'GST 111',
      score: 13,
      totalQuestions: 16,
      percentage: 81.3,
      submittedAt: '2026-11-10T10:15:30.000Z',
      submissionReceipt: 'SUN-CBT-667788-WAT',
      batch: 'Batch B',
      answers: {
        q1: 0, q2: 0, q3: 0, q4: 1, q5: 0, q6: 1, q7: 0, q8: 0,
        q9: 0, q10: 1, q11: 0, q12: 1, q13: 2, q14: 0, q15: 1, q16: -1
      },
      questionSnapshot: [
        ...sampleQuestions,
        ...sampleQuestions.map((q, i) => ({
          ...q,
          id: `q${i + 9}`,
          questionNumber: i + 9,
          questionText: `Advanced Item ${i + 9}: ${q.questionText}`
        }))
      ]
    }
  }
];

async function runTests() {
  const outputDir = path.resolve('test-docx-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Running DOCX export tests into: ${outputDir}`);

  for (const tc of testCases) {
    const examToUse = tc.sub.id === 'sub_003' ? { ...sampleExam, lecturerName: undefined } : sampleExam;
    const blob = await exportIndividualScriptToWord(examToUse, tc.sub);
    const arrayBuffer = await (blob as any).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filePath = path.join(outputDir, tc.filename);
    fs.writeFileSync(filePath, buffer);
    console.log(`✓ Generated ${tc.name} -> ${tc.filename} (${buffer.length} bytes)`);
  }

  console.log('All 5 test DOCX documents successfully generated!');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
