export type AttemptMode = 'blind_solved' | 'blind_unsolved' | 'blind_partial' | 'detour_solved' | 'smooth_solved' | 'read_solution_only' | 'reviewed_solution' | 'skipped';
export type Outcome = 'correct' | 'mostly_correct' | 'partial' | 'wrong' | 'gave_up' | 'not_attempted';
export type PathQuality = 'none' | 'messy' | 'detour' | 'reasonable' | 'clean';

export interface AttemptData {
  mastery: number;
  outcome: Outcome;
  attemptMode: AttemptMode;
  pathQuality: PathQuality;
}

export interface FSRSState {
  stability: number;
  difficulty: number;
}

// FSRS v4 default parameters
const W = [
  0.4072, 1.1829, 3.1262, 15.4722, // w[0-3]: initial stability per grade 1..4
  7.2102, 0.5316,                    // w[4-5]: initial difficulty params
  1.0651, 0.0589,                    // w[6-7]: difficulty update
  1.4675, 0.1264, 1.0152,           // w[8-10]: stability after recall
  1.9395, 0.1100, 0.2900, 2.2700,   // w[11-14]: stability after forgetting
  0.2500, 2.9898,                    // w[15-16]: hard penalty / easy bonus
];

const DESIRED_RETENTION = 0.9;
const LN_09 = Math.log(0.9);

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// Map the user's mastery/quality/outcome to an FSRS grade (1–4)
function toGrade(data: AttemptData): 1 | 2 | 3 | 4 {
  const { mastery, outcome, attemptMode, pathQuality } = data;
  if (outcome === 'gave_up' || mastery === 0) return 1;
  if (attemptMode === 'read_solution_only' || mastery === 1) return 2;
  if (mastery === 2 || (mastery === 3 && (pathQuality === 'messy' || pathQuality === 'detour'))) return 3;
  return 4; // mastery 3 (clean/reasonable) or mastery 4
}

// R(t, S) = 0.9^(t/S) — retrievability after t days given stability S
function retrievability(elapsedDays: number, S: number): number {
  if (S <= 0) return 0;
  return Math.exp(LN_09 * elapsedDays / S);
}

function initStability(grade: 1 | 2 | 3 | 4): number {
  return Math.max(0.1, W[grade - 1]);
}

function initDifficulty(grade: 1 | 2 | 3 | 4): number {
  return clamp(W[4] - (grade - 3) * W[5], 1, 10);
}

function nextDifficulty(D: number, grade: 1 | 2 | 3 | 4): number {
  return clamp(W[7] * W[4] + (1 - W[7]) * (D - W[6] * (grade - 3)), 1, 10);
}

function stabilityAfterRecall(S: number, D: number, R: number, grade: 2 | 3 | 4): number {
  const base = S * (
    Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) + 1
  );
  if (grade === 2) return Math.max(0.1, base * W[15]);
  if (grade === 4) return Math.max(S, base * W[16]);
  return Math.max(S, base);
}

function stabilityAfterForgetting(S: number, D: number, R: number): number {
  return Math.max(
    0.1,
    W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R)),
  );
}

function intervalDays(S: number): number {
  // Solve R(I, S) = DESIRED_RETENTION  =>  I = S * ln(r)/ln(0.9)
  // With r = 0.9 this simplifies to I = S.
  const days = S * (Math.log(DESIRED_RETENTION) / LN_09);
  return Math.max(1, Math.round(days));
}

export function scheduleFSRS(
  data: AttemptData,
  lastAttemptAt: string | null,
  currentState: FSRSState | null,
): { nextReview: Date; state: FSRSState } {
  const grade = toGrade(data);

  let newS: number;
  let newD: number;

  if (!currentState || currentState.stability <= 0) {
    // First review — initialise from grade
    newS = initStability(grade);
    newD = initDifficulty(grade);
  } else {
    const { stability: S, difficulty: D } = currentState;
    const lastDate = lastAttemptAt ? new Date(lastAttemptAt) : new Date();
    const elapsedDays = Math.max(0, (Date.now() - lastDate.getTime()) / 86400000);
    const R = retrievability(elapsedDays, S);

    newD = nextDifficulty(D, grade);
    newS = grade === 1
      ? stabilityAfterForgetting(S, D, R)
      : stabilityAfterRecall(S, D, R, grade as 2 | 3 | 4);
  }

  const days = intervalDays(newS);
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + days);
  nextReview.setHours(0, 0, 0, 0);

  return { nextReview, state: { stability: newS, difficulty: newD } };
}

// Kept for any legacy call-sites
export function calculateNextReview(data: AttemptData): Date {
  return scheduleFSRS(data, null, null).nextReview;
}
