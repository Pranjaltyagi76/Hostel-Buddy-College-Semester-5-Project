'use strict';

// Deterministic, explainable duplicate detection. It intentionally avoids an
// external AI service: the same two complaints always receive the same score,
// and every match carries the factors that produced it.

const DUPLICATE_WINDOW_DAYS = 30;
const DUPLICATE_THRESHOLD = 70;
const MAX_MATCHES = 3;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'been', 'for', 'from', 'has', 'have',
  'hostel', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'our', 'please',
  'problem', 'room', 'that', 'the', 'there', 'this', 'to', 'was', 'were',
  'with',
]);

const HIGH_SIGNAL_TERMS = new Set([
  'fire', 'flood', 'gas', 'leak', 'sewage', 'shock', 'smoke', 'spark',
  'water', 'wifi',
]);

function stem(token) {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function significantTokens(text) {
  const normalized = String(text || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/wi[\s-]?fi/g, 'wifi')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!normalized) return [];
  return [...new Set(
    normalized
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
      .map(stem)
  )].sort();
}

function sameRoom(left, right) {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function assessPair(input, candidate) {
  const inputTokens = significantTokens(input.description);
  const candidateTokens = significantTokens(candidate.problem_description);
  if (!inputTokens.length || !candidateTokens.length) return null;

  const candidateSet = new Set(candidateTokens);
  const sharedTerms = inputTokens.filter((token) => candidateSet.has(token));
  const textSimilarity = (2 * sharedTerms.length) / (inputTokens.length + candidateTokens.length);
  const categoryMatch = input.category === candidate.category;
  const roomMatch = sameRoom(input.roomNumber, candidate.room_number);
  const exactTerms = inputTokens.length === candidateTokens.length &&
    sharedTerms.length === inputTokens.length;

  // Text carries most of the score. Category and exact room are contextual
  // boosts, but neither can make unrelated descriptions a duplicate alone.
  const score = Math.round((textSimilarity * 75) + (categoryMatch ? 15 : 0) + (roomMatch ? 10 : 0));
  const exactEvidence = exactTerms && (
    inputTokens.length >= 2 || categoryMatch || sharedTerms.some((term) => HIGH_SIGNAL_TERMS.has(term))
  );
  const enoughEvidence = sharedTerms.length >= 2 || exactEvidence ||
    (categoryMatch && roomMatch && textSimilarity >= 0.6);
  if (score < DUPLICATE_THRESHOLD || !enoughEvidence) return null;

  const reasons = [`${Math.round(textSimilarity * 100)}% meaningful-text overlap`];
  if (categoryMatch) reasons.push('same category');
  if (roomMatch) reasons.push('same room');
  reasons.push(`shared terms: ${sharedTerms.slice(0, 5).join(', ')}`);

  return {
    complaint_id: candidate.complaint_id,
    category: candidate.category,
    status: candidate.status,
    created_at: candidate.created_at,
    similarity_score: score,
    match_reason: reasons.join('; '),
  };
}

function findDuplicateMatches(input, candidates) {
  return candidates
    .map((candidate) => assessPair(input, candidate))
    .filter(Boolean)
    .sort((a, b) => b.similarity_score - a.similarity_score || b.complaint_id - a.complaint_id)
    .slice(0, MAX_MATCHES);
}

module.exports = {
  DUPLICATE_WINDOW_DAYS,
  DUPLICATE_THRESHOLD,
  MAX_MATCHES,
  significantTokens,
  assessPair,
  findDuplicateMatches,
};
