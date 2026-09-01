'use strict';

// HTTP layer for complaints. Builds the image URL from the uploaded file,
// delegates to the service, and cleans up an orphaned upload if the service
// rejects the request (e.g. validation fails after Multer already saved it).
const complaintsService = require('./complaints.service');
const { removeUploadedFile } = require('../../middleware/upload');

const imageUrlOf = (file) => (file ? `/uploads/${file.filename}` : null);
const idOf = (req) => Number(req.params.id);

function create(req, res, next) {
  try {
    const complaint = complaintsService.createComplaint(req.user.userId, req.body, imageUrlOf(req.file));
    res.status(201).json(complaint);
  } catch (err) {
    if (req.file) removeUploadedFile(req.file.filename);
    next(err);
  }
}

function listMine(req, res, next) {
  try {
    res.json(complaintsService.listMine(req.user.userId));
  } catch (err) {
    next(err);
  }
}

function getOne(req, res, next) {
  try {
    res.json(complaintsService.getOne(req.user, idOf(req)));
  } catch (err) {
    next(err);
  }
}

// The body may carry a `remove_image` flag alongside the editable fields; the
// service decides what it means.
function update(req, res, next) {
  try {
    const complaint = complaintsService.updateComplaint(
      req.user.userId,
      idOf(req),
      req.body,
      imageUrlOf(req.file)
    );
    res.json(complaint);
  } catch (err) {
    if (req.file) removeUploadedFile(req.file.filename);
    next(err);
  }
}

function remove(req, res, next) {
  try {
    res.json(complaintsService.deleteComplaint(req.user.userId, idOf(req)));
  } catch (err) {
    next(err);
  }
}

// Staff: list complaints with search/filter/pagination. The requester is
// passed through because the service narrows the results to their hostel.
function listAll(req, res, next) {
  try {
    const { q, category, status, page, limit } = req.query;
    res.json(complaintsService.listAll(req.user, { q, category, status, page, limit }));
  } catch (err) {
    next(err);
  }
}

// Staff: change a complaint's status and remarks. The requester is passed
// through so the service can refuse a complaint outside their hostel.
function updateStatus(req, res, next) {
  try {
    res.json(complaintsService.updateStatus(req.user, idOf(req), req.body));
  } catch (err) {
    next(err);
  }
}

module.exports = { create, listMine, getOne, update, remove, listAll, updateStatus };
