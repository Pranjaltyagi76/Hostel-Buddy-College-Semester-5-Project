'use strict';

// Explainable complaint triage. This is deliberately deterministic: the same
// category and description always produce the same priority, score, SLA and
// human-readable reason. No external service, secret, or opaque model is
// involved, so staff can defend every decision and tests can pin the policy.

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const SLA_STATES = ['on_track', 'overdue', 'met', 'missed'];

const POLICY = {
  Low: { minScore: 0, slaHours: 72 },
  Medium: { minScore: 35, slaHours: 24 },
  High: { minScore: 60, slaHours: 8 },
  Critical: { minScore: 85, slaHours: 2 },
};

const CATEGORY_SCORES = {
  Electricity: 60,
  Security: 65,
  'Water Supply': 50,
  Plumbing: 40,
  Cleaning: 30,
  'Wi-Fi': 30,
  Furniture: 20,
  Other: 25,
};

// Phrases are grouped by operational impact. Longer, specific phrases avoid
// marking harmless text such as "broken chair" as a safety emergency.
const SIGNALS = [
  {
    // Immediate safety hazards must reach Critical even when the student
    // selected a low-baseline category such as "Other".
    points: 65,
    label: 'immediate safety hazard',
    phrases: [
      'fire', 'smoke', 'gas leak', 'electric shock', 'electrocution',
      'sparking', 'exposed wire', 'short circuit', 'burst pipe',
      'flooding', 'someone trapped', 'life threatening',
    ],
  },
  {
    points: 25,
    label: 'major service or security failure',
    phrases: [
      'power cut', 'power outage', 'no electricity', 'no water',
      'water outage', 'broken lock', 'door will not lock', 'sewage',
      'overflowing', 'ceiling leak', 'no wi-fi', 'no wifi',
    ],
  },
  {
    points: 10,
    label: 'urgent wording',
    phrases: ['urgent', 'immediately', 'dangerous', 'emergency', 'unsafe'],
  },
];

function matchedSignals(description) {
  const text = description.toLowerCase();
  const matches = [];
  let points = 0;

  for (const signal of SIGNALS) {
    const phrase = signal.phrases.find((candidate) => text.includes(candidate));
    if (!phrase) continue;
    points += signal.points;
    matches.push(`${signal.label} ("${phrase}")`);
  }

  return { points, matches };
}

function priorityForScore(score) {
  if (score >= POLICY.Critical.minScore) return 'Critical';
  if (score >= POLICY.High.minScore) return 'High';
  if (score >= POLICY.Medium.minScore) return 'Medium';
  return 'Low';
}

function assessComplaint({ category, description }) {
  const baseScore = CATEGORY_SCORES[category] ?? 25;
  const signals = matchedSignals(description || '');
  const score = Math.min(100, baseScore + signals.points);
  const priority = priorityForScore(score);
  const slaHours = POLICY[priority].slaHours;
  const reasonParts = [`${category || 'Other'} category baseline`];
  if (signals.matches.length) reasonParts.push(...signals.matches);
  else reasonParts.push('no additional urgency signals');

  return {
    priority,
    score,
    slaHours,
    reason: reasonParts.join('; '),
  };
}

module.exports = { PRIORITIES, SLA_STATES, POLICY, assessComplaint };
