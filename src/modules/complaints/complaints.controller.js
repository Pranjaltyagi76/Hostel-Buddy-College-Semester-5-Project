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

module.exports = { create, listMine, getOne, update, remove };
