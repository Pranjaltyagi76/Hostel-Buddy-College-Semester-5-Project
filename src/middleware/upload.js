'use strict';

// Image upload handling for complaints. Wraps Multer so that:
//  - files land in the configured upload directory with safe unique names,
//  - only PNG/JPEG/WEBP within the size limit are accepted,
//  - the file's actual bytes are checked, not just its declared type,
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

// --- Content sniffing -------------------------------------------------------
// The MIME type in a multipart part header is supplied by the client and can
// say anything. Identify the file by its leading bytes instead, so a text file
// labelled "image/png" never reaches the uploads directory.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEADER_BYTES = 12; // enough for the longest signature we check (WEBP)

function detectImageType(head) {
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// Read just the first few bytes of the saved file — no need to load all 5 MB.
function readHeader(filePath) {
  const buffer = Buffer.alloc(HEADER_BYTES);
  const fd = fs.openSync(filePath, 'r');
  try {
    const bytesRead = fs.readSync(fd, buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

// Verify the uploaded file really is the image type it claims to be.
// Returns an AppError to pass to next(), or null when the file is fine.
function verifyUploadedImage(file) {
  let actualType;
  try {
    actualType = detectImageType(readHeader(file.path));
  } catch {
    return new AppError('The image could not be read. Please try again.', 400, 'UPLOAD_ERROR');
  }

  if (!actualType) {
    return new AppError(
      'That file is not a PNG, JPEG, or WEBP image. Please attach a real image file.',
      400,
      'INVALID_FILE_TYPE'
    );
  }
  if (actualType !== file.mimetype) {
    // e.g. a PNG sent as image/jpeg — the stored extension and the served
    // Content-Type would disagree with the bytes.
    return new AppError(
      'The image contents do not match the file type. Please re-save the image and try again.',
      400,
      'INVALID_FILE_TYPE'
    );
  }
  return null;
}

// Multer's own error strings are written for developers. Map the ones a user
// can actually cause onto messages that explain what to do instead.
function toAppError(err) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return new AppError('Image is too large (max 5 MB)', 400, 'FILE_TOO_LARGE');
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
    return new AppError(
      'Please attach a single image using the "image" field.',
      400,
      'UPLOAD_ERROR'
    );
  }
  return new AppError('The image could not be uploaded. Please try again.', 400, 'UPLOAD_ERROR');
}

// Middleware accepting a single optional "image" field.
function uploadImage(req, res, next) {
  multerUpload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) return next(toAppError(err));
      return next(err); // AppError from fileFilter, or anything unexpected
    }

    if (!req.file) return next();

    const problem = verifyUploadedImage(req.file);
    if (problem) {
      removeUploadedFile(req.file.filename);
      delete req.file;
      return next(problem);
    }
    next();
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
