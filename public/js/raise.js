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
const MAX_BYTES = 5 * 1024 * 1024;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  UI.hideAlert('formError'); UI.hideAlert('formSuccess');

  const category = categorySel.value;
  const desc = description.value.trim();
  if (!category) return UI.showError('formError', 'Please select a category.');
  if (!desc) return UI.showError('formError', 'Please describe the issue.');

  const file = imageInput.files[0];
  if (file && file.size > MAX_BYTES) {
    return UI.showError('formError', 'Image is too large (max 5 MB).');
  }

  const fd = new FormData();
  fd.append('category', category);
  fd.append('description', desc);
  if (file) fd.append('image', file);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';
  try {
    await API.postForm('/complaints', fd);
    UI.showSuccess('formSuccess', 'Complaint submitted! Redirecting to My Complaints…');
    setTimeout(() => { location.href = 'my-complaints.html'; }, 900);
  } catch (err) {
    UI.showError('formError', err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Complaint';
  }
});
