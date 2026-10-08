import { Router } from 'express';
import type { createMeetingController } from '../controllers/meeting.controller.js';
export function meetingRoutes(controller: ReturnType<typeof createMeetingController>) {
  const router = Router();
  router.post('/', controller.createMeeting);
  router.get('/', controller.listMeetings);
  router.get('/:meetingId/summary', controller.getSummary);
  router.get('/:meetingId', controller.getMeeting);
  router.post('/:meetingId/edit', controller.editMeeting);
  router.post('/:meetingId/team', controller.updateTeam);
  router.post('/:meetingId/cancel', controller.cancelMeeting);
  router.post('/:meetingId/delete', controller.deleteMeeting);
  router.get('/:meetingId/notes/me', controller.getOwnNote);
  router.post('/:meetingId/notes/me', controller.saveOwnNote);
  router.get('/:meetingId/feedback', controller.readFeedback);
  router.post('/:meetingId/feedback', controller.createFeedback);
  router.post('/:meetingId/feedback/:feedbackId/edit', controller.editFeedback);
  return router;
}
