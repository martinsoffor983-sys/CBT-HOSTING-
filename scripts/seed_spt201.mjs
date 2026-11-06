import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const app = initializeApp(firebaseConfig, 'seeder');
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const spt201Data = {
  courseCode: 'SPT 201',
  courseTitle: 'Introduction to Human Kinetics and Exercise Physiology',
  department: 'Human Kinetics & Sports Science',
  durationMinutes: 45,
  startDate: '2026-01-01T08:00',
  endDate: '2026-12-31T23:59',
  instructions: '1. Read every question carefully before selecting an answer.\n2. You cannot go back after submitting.\n3. The examination will automatically submit when the timer expires.\n4. Do not refresh or exit the browser window during testing.',
  status: 'published',
  questionsCount: 5,
  targetQuestionsCount: 5,
  randomizationEnabled: true,
  createdAt: '2026-11-04T12:00:00.000Z',
  updatedAt: new Date().toISOString(),
  questions: [
    {
      id: 'q1',
      question: 'What is the primary high-energy molecule utilized during immediate high-intensity muscular contractions?',
      options: [
        'Adenosine Triphosphate (ATP)',
        'Lactic Acid',
        'Glycogen',
        'Creatinine'
      ],
      correctAnswer: 0
    },
    {
      id: 'q2',
      question: 'Which anatomical plane divides the human body into anterior (front) and posterior (back) halves?',
      options: [
        'Sagittal plane',
        'Coronal (Frontal) plane',
        'Transverse plane',
        'Horizontal plane'
      ],
      correctAnswer: 1
    },
    {
      id: 'q3',
      question: 'During endurance aerobic exercise, which organ system is primarily responsible for oxygen transport to working skeletal muscle fibers?',
      options: [
        'Endocrine system',
        'Integumentary system',
        'Cardiovascular system',
        'Digestive system'
      ],
      correctAnswer: 2
    },
    {
      id: 'q4',
      question: 'What physiological phenomenon is characterized by delayed muscular soreness 24 to 48 hours following strenuous unaccustomed eccentric training?',
      options: [
        'Acute Muscle Strain',
        'DOMS (Delayed Onset Muscle Soreness)',
        'Chronic Fatigue Syndrome',
        'Tendonitis'
      ],
      correctAnswer: 1
    },
    {
      id: 'q5',
      question: 'Which energy pathway does not require oxygen and operates primarily during maximal bouts of activity lasting 30 to 90 seconds?',
      options: [
        'Aerobic oxidative phosphorylation',
        'Anaerobic glycolysis',
        'Beta-oxidation',
        'Krebs cycle'
      ],
      correctAnswer: 1
    }
  ]
};

async function seed() {
  console.log('Seeding exam_sun_spt201...');
  await setDoc(doc(db, 'exams', 'exam_sun_spt201'), spt201Data);
  console.log('Successfully seeded exam_sun_spt201 into Firestore!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
