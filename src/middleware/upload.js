'use strict';

// Image upload handling for complaints. Wraps Multer so that:
//  - files land in the configured upload directory with safe unique names,
//  - only PNG/JPEG/WEBP within the size limit are accepted,
//  - Multer's own errors are converted into our standard AppError shape.
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config/env');
const { AppError } = require('./errorHandler');

fs.mkdirSync(config.uploadDir, { recursive: true });

// Allowed MIME types mapped to the extension we store.
const ALLOWED = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const ext = ALLOWED[file.mimetype] || path.extname(file.originalname) || '';
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, unique);
  },
});

function fileFilter(req, file, cb) {
  if (ALLOWED[file.mimetype]) return cb(null, true);
  cb(new AppError('Only PNG, JPEG, or WEBP images are allowed', 400, 'INVALID_FILE_TYPE'));
}

const multerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.maxUploadBytes },
});

// Middleware accepting a single optional "image" field.
function uploadImage(req, res, next) {
  multerUpload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('Image is too large (max 5 MB)', 400, 'FILE_TOO_LARGE'));
      }
      return next(new AppError(err.message, 400, 'UPLOAD_ERROR'));
    }
    next(err); // AppError from fileFilter, or anything unexpected
  });
}

// Best-effort deletion of an uploaded file (used to clean up orphans on error
// and to remove images when a complaint is edited or deleted).
function removeUploadedFile(filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(config.uploadDir, path.basename(filename)));
  } catch {
    /* file already gone — ignore */
  }
}

module.exports = { uploadImage, removeUploadedFile };
