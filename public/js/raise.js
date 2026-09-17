'use strict';

if (!Auth.requireStudent()) throw new Error('redirecting');
UI.renderNav('raise');

// Populate category options.
const categorySel = document.getElementById('category');
CATEGORIES.forEach((c) => {
  const opt = document.createElement('option');
  opt.value = c; opt.textContent = c;
  categorySel.appendChild(opt);
});

// Live character counter.
const description = document.getElementById('description');
const charCount = document.getElementById('charCount');
description.addEventListener('input', () => { charCount.textContent = description.value.length; });

const form = document.getElementById('complaintForm');
const submitBtn = document.getElementById('submitBtn');
const imageInput = document.getElementById('image');
const videoInput = document.getElementById('video');
const duplicateWarning = document.getElementById('duplicateWarning');
let approvedDuplicateDraft = null;

function draftSignature(category, desc) {
  return `${category}\n${desc}`;
}

function resetDuplicateApproval() {
  approvedDuplicateDraft = null;
  duplicateWarning.hidden = true;
  duplicateWarning.innerHTML = '';
  submitBtn.textContent = 'Submit Complaint';
}

categorySel.addEventListener('change', resetDuplicateApproval);
description.addEventListener('input', resetDuplicateApproval);

function showDuplicateWarning(result, signature) {
  approvedDuplicateDraft = signature;
  duplicateWarning.hidden = false;
  duplicateWarning.innerHTML = `
    <h4>Possible duplicate detected</h4>
    <div>Similar active work may already be in the maintenance queue:</div>
    <ul>${result.matches.map((match) => `<li>
      Complaint #${match.complaint_id} · ${UI.esc(match.category)} · ${UI.statusBadge(match.status)} · ${match.similarity_score}% match
    </li>`).join('')}</ul>
    <div class="duplicate-note">For privacy, descriptions and student details are not shown. If this is a separate incident, select “Submit Anyway”.</div>`;
  submitBtn.textContent = 'Submit Anyway';
}

// Mirrors the server's limits, so an oversized file is caught before it is
// uploaded rather than after. The server enforces them regardless.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  UI.hideAlert('formError'); UI.hideAlert('formSuccess');

  const category = categorySel.value;
  const desc = description.value.trim();
  if (!category) return UI.showError('formError', 'Please select a category.');
  if (!desc) return UI.showError('formError', 'Please describe the issue.');

  const image = imageInput.files[0];
  if (image && image.size > MAX_IMAGE_BYTES) {
    return UI.showError('formError', 'Image is too large (max 5 MB).');
  }
  const video = videoInput.files[0];
  if (video && video.size > MAX_VIDEO_BYTES) {
    return UI.showError('formError', 'Video is too large (max 30 MB).');
  }

  const signature = draftSignature(category, desc);
  if (approvedDuplicateDraft !== signature) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Checking for duplicates…';
    try {
      const result = await API.post('/complaints/duplicates/check', { category, description: desc });
      if (result.possible_duplicate) {
        showDuplicateWarning(result, signature);
        submitBtn.disabled = false;
        return;
      }
    } catch (err) {
      UI.showError('formError', err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Complaint';
      return;
    }
  }

  const fd = new FormData();
  fd.append('category', category);
  fd.append('description', desc);
  if (image) fd.append('image', image);
  if (video) fd.append('video', video);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';
  try {
    const created = await API.postForm('/complaints', fd);
    const linked = created.duplicate_count > 0
      ? ` It was linked to ${created.duplicate_count} possible duplicate${created.duplicate_count === 1 ? '' : 's'} for staff review.`
      : '';
    UI.showSuccess('formSuccess', `Complaint submitted!${linked} Redirecting to My Complaints…`);
    setTimeout(() => { location.href = 'my-complaints.html'; }, 900);
  } catch (err) {
    UI.showError('formError', err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Complaint';
  }
});
