'use strict';

// Attachment handling for complaints. Wraps Multer so that:
//  - files land in the configured upload directory with safe unique names,
//  - each field accepts only its own media kinds, within its own size limit,
//  - the file's actual bytes are checked, not just its declared type,
//  - Multer's own errors are converted into our standard AppError shape.
//
// A complaint may carry one image and one video. They are separate fields
// rather than one "attachment" field because they have different size limits
// and are rendered differently, and because a student reporting a fault often
// wants to show both the damage and the behaviour.
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config/env');
const { AppError } = require('./errorHandler');

fs.mkdirSync(config.uploadDir, { recursive: true });

// Allowed MIME types mapped to the extension we store.
const IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

// Only the two containers every current browser can play from a <video> tag.
// Accepting .mkv or .mov would mean storing files the complaint page cannot
// actually show.
const VIDEO_TYPES = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

// The upload fields and the rules that apply to each. Everything downstream
// derives from this table, so adding a field is a single entry.
const MB = 1024 * 1024;

const FIELDS = {
  image: {
    types: IMAGE_TYPES,
    maxBytes: config.maxUploadBytes,
    reject: 'Only PNG, JPEG, or WEBP images are allowed',
    tooLarge: `Image is too large (max ${Math.round(config.maxUploadBytes / MB)} MB)`,
  },
  video: {
    types: VIDEO_TYPES,
    maxBytes: config.maxVideoBytes,
    reject: 'Only MP4 or WEBM videos are allowed',
    tooLarge: `Video is too large (max ${Math.round(config.maxVideoBytes / MB)} MB)`,
  },
};

const ALL_TYPES = { ...IMAGE_TYPES, ...VIDEO_TYPES };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const ext = ALL_TYPES[file.mimetype] || path.extname(file.originalname) || '';
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, unique);
  },
});

// A first, cheap gate on the declared type, so an image field never even
// starts writing a video to disk. The real check happens once the bytes land.
function fileFilter(req, file, cb) {
  const rules = FIELDS[file.fieldname];
  if (!rules) return cb(new AppError('Unexpected file field', 400, 'UPLOAD_ERROR'));
  if (rules.types[file.mimetype]) return cb(null, true);
  cb(new AppError(rules.reject, 400, 'INVALID_FILE_TYPE'));
}

// Multer applies one byte limit to the whole request, so it has to be the
// larger of the two. The smaller per-field limit is enforced afterwards,
// against the size Multer records once the file is written.
const multerUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: Math.max(config.maxUploadBytes, config.maxVideoBytes),
    files: Object.keys(FIELDS).length,
  },
});

// --- Content sniffing -------------------------------------------------------
// The MIME type in a multipart part header is supplied by the client and can
// say anything. Identify the file by its leading bytes instead, so a text file
// labelled "image/png" never reaches the uploads directory.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EBML_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

// Enough for every signature below. The widest is WebM, whose DocType sits a
// little way past the 4-byte EBML marker.
const HEADER_BYTES = 64;

// An MP4 declares its flavour in the four bytes after "ftyp". Restricting the
// set keeps out the other formats that share the ISO base container — notably
// QuickTime ("qt  "), which a browser will not play.
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ',
]);

function detectImage(head) {
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

function detectVideo(head) {
  // MP4 and its relatives: a "ftyp" box at offset 4, then the major brand.
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
    return MP4_BRANDS.has(head.subarray(8, 12).toString('latin1')) ? 'video/mp4' : null;
  }
  // WebM and Matroska share the EBML header, so the marker alone is not
  // enough — the DocType decides, and it appears within the first few dozen
  // bytes. Without this an .mkv would be stored as a .webm the page cannot play.
  if (head.length >= 4 && head.subarray(0, 4).equals(EBML_SIGNATURE)) {
    return head.toString('latin1').includes('webm') ? 'video/webm' : null;
  }
  return null;
}

function detectType(head) {
  return detectImage(head) || detectVideo(head);
}

// Read just the first few bytes of the saved file — no need to load all 30 MB.
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

// Verify one uploaded file really is what its field expects.
// Returns an AppError to pass to next(), or null when the file is fine.
function verifyUploadedFile(file) {
  const rules = FIELDS[file.fieldname];
  if (!rules) {
    return new AppError('Unexpected file field', 400, 'UPLOAD_ERROR');
  }

  // Multer's own ceiling is the larger of the two limits, so the smaller field
  // has to be policed here, once the final size is known.
  if (file.size > rules.maxBytes) {
    return new AppError(rules.tooLarge, 400, 'FILE_TOO_LARGE');
  }

  let actualType;
  try {
    actualType = detectType(readHeader(file.path));
  } catch {
    return new AppError('The file could not be read. Please try again.', 400, 'UPLOAD_ERROR');
  }

  // Either unrecognised entirely, or a kind this field does not take — a real
  // video sent as the "image" field is still wrong.
  if (!actualType || !rules.types[actualType]) {
    return new AppError(
      `${rules.reject}. Please attach a real file of that type.`,
      400,
      'INVALID_FILE_TYPE'
    );
  }
  if (actualType !== file.mimetype) {
    // e.g. a PNG sent as image/jpeg — the stored extension and the served
    // Content-Type would disagree with the bytes.
    return new AppError(
      'The file contents do not match the file type. Please re-save the file and try again.',
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
    // err.field names the input that overflowed, so the message can quote the
    // limit the user actually hit rather than the shared ceiling.
    const rules = FIELDS[err.field];
    return new AppError(rules ? rules.tooLarge : 'That file is too large', 400, 'FILE_TOO_LARGE');
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
    return new AppError(
      'Please attach at most one image and one video, using the "image" and "video" fields.',
      400,
      'UPLOAD_ERROR'
    );
  }
  return new AppError('The file could not be uploaded. Please try again.', 400, 'UPLOAD_ERROR');
}

// Flattens Multer's { image: [file], video: [file] } into a plain list.
function uploadedFiles(req) {
  return Object.values(req.files || {}).flat();
}

// Middleware accepting an optional "image" and an optional "video".
function uploadComplaintMedia(req, res, next) {
  const fields = Object.keys(FIELDS).map((name) => ({ name, maxCount: 1 }));

  multerUpload.fields(fields)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) return next(toAppError(err));
      return next(err); // AppError from fileFilter, or anything unexpected
    }

    const files = uploadedFiles(req);
    if (!files.length) return next();

    // One bad attachment fails the whole request, so a rejected upload never
    // leaves its companion file orphaned on disk.
    for (const file of files) {
      const problem = verifyUploadedFile(file);
      if (problem) {
        files.forEach((f) => removeUploadedFile(f.filename));
        req.files = {};
        return next(problem);
      }
    }
    next();
  });
}

// Best-effort deletion of an uploaded file (used to clean up orphans on error
// and to remove attachments when a complaint is edited or deleted).
function removeUploadedFile(filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(config.uploadDir, path.basename(filename)));
  } catch {
    /* file already gone — ignore */
  }
}

module.exports = { uploadComplaintMedia, removeUploadedFile, uploadedFiles };
