'use strict';

// HTTP layer for complaints. Builds the attachment URLs from the uploaded
// files, delegates to the service, and cleans up orphaned uploads if the
// service rejects the request (e.g. validation fails after Multer already
// saved them).
const complaintsService = require('./complaints.service');
const { removeUploadedFile, uploadedFiles } = require('../../middleware/upload');

const idOf = (req) => Number(req.params.id);

// Multer's .fields() hands back { image: [file], video: [file] }, either key
// absent when nothing was attached.
const urlOf = (req, field) => {
  const file = req.files?.[field]?.[0];
  return file ? `/uploads/${file.filename}` : null;
};

const mediaOf = (req) => ({ imageUrl: urlOf(req, 'image'), videoUrl: urlOf(req, 'video') });

// Both attachments are discarded together: if the complaint was not written,
// neither file has anything referring to it.
const discardUploads = (req) => uploadedFiles(req).forEach((f) => removeUploadedFile(f.filename));

async function create(req, res, next) {
  try {
    const complaint = (await complaintsService.createComplaint(req.user.userId, req.body, mediaOf(req)));
    res.status(201).json(complaint);
  } catch (err) {
    discardUploads(req);
    next(err);
  }
}

async function checkDuplicates(req, res, next) {
  try {
    res.json((await complaintsService.checkDuplicates(req.user.userId, req.body)));
  } catch (err) {
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    res.json((await complaintsService.listMine(req.user.userId)));
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    res.json((await complaintsService.getOne(req.user, idOf(req))));
  } catch (err) {
    next(err);
  }
}

// The body may carry `remove_image` / `remove_video` flags alongside the
// editable fields; the service decides what they mean.
async function update(req, res, next) {
  try {
    const complaint = (await complaintsService.updateComplaint(
      req.user.userId,
      idOf(req),
      req.body,
      mediaOf(req)
    ));
    res.json(complaint);
  } catch (err) {
    discardUploads(req);
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    res.json((await complaintsService.deleteComplaint(req.user.userId, idOf(req))));
  } catch (err) {
    next(err);
  }
}

// Staff: list complaints with search/filter/pagination. The requester is
// passed through because the service narrows the results to their hostel.
async function listAll(req, res, next) {
  try {
    const { q, category, status, priority, sla, page, limit } = req.query;
    res.json((await complaintsService.listAll(req.user, { q, category, status, priority, sla, page, limit })));
  } catch (err) {
    next(err);
  }
}

// Staff: change a complaint's status and remarks. The requester is passed
// through so the service can refuse a complaint outside their hostel.
async function updateStatus(req, res, next) {
  try {
    res.json((await complaintsService.updateStatus(req.user, idOf(req), req.body)));
  } catch (err) {
    next(err);
  }
}

module.exports = { checkDuplicates, create, listMine, getOne, update, remove, listAll, updateStatus };
