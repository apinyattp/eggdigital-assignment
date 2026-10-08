import type { Request, Response, NextFunction } from 'express';
import type { MeetingService } from '../services/meeting.service.js';
export function createMeetingController(service: MeetingService) {
  return {
    async createMeeting(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await service.saveMeeting(res.locals.user, req.body);
        if (result.created) res.location('/api/v1/meetings/' + result.meeting.id);
        res.status(result.created ? 201 : 200).json({ meeting: result.meeting });
      } catch (error) {
        next(error);
      }
    },
    async editMeeting(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await service.editMeeting(res.locals.user, req.params.meetingId, req.body);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
    async updateTeam(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await service.editMeeting(
          res.locals.user,
          req.params.meetingId,
          req.body,
          'team',
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
    async cancelMeeting(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await service.editMeeting(
          res.locals.user,
          req.params.meetingId,
          req.body,
          'cancel',
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
    async listMeetings(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await service.listMeetings(res.locals.user, req.query);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
    async getSummary(req: Request, res: Response, next: NextFunction) {
      try {
        const meeting = await service.findSummary(res.locals.user, req.params.meetingId);
        res.json({ meeting });
      } catch (error) {
        next(error);
      }
    },
    async deleteMeeting(req: Request, res: Response, next: NextFunction) {
      try {
        await service.deleteMeeting(res.locals.user, req.params.meetingId, req.body);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
    async getOwnNote(req: Request, res: Response, next: NextFunction) {
      try {
        const note = await service.getOwnNote(res.locals.user, req.params.meetingId, req.query);
        res.json({ note });
      } catch (error) {
        next(error);
      }
    },
    async saveOwnNote(req: Request, res: Response, next: NextFunction) {
      try {
        const note = await service.saveOwnNote(res.locals.user, req.params.meetingId, req.body);
        res.json({ note });
      } catch (error) {
        next(error);
      }
    },
    async readFeedback(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await service.readFeedback(res.locals.user, req.params.meetingId, req.query);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
    async createFeedback(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await service.createFeedback(
          res.locals.user,
          req.params.meetingId,
          req.body,
        );
        res.status(result.created ? 201 : 200).json({ feedback: result.feedback });
      } catch (error) {
        next(error);
      }
    },
    async editFeedback(req: Request, res: Response, next: NextFunction) {
      try {
        const feedback = await service.editFeedback(
          res.locals.user,
          req.params.meetingId,
          req.params.feedbackId,
          req.body,
        );
        res.json({ feedback });
      } catch (error) {
        next(error);
      }
    },
    async getMeeting(req: Request, res: Response, next: NextFunction) {
      try {
        const meeting = await service.findMeeting(res.locals.user, req.params.meetingId);
        res.json({ meeting });
      } catch (error) {
        next(error);
      }
    },
  };
}
