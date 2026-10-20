import type { Request, Response } from 'express';
import { listTimetables } from '../services/timetablesService';
import { sendApiError } from './apiError';

export async function getTimetables(req: Request, res: Response) {
  try {
    const workspaceId = (typeof req.query.workspaceId === 'string' && req.query.workspaceId.trim()) || 'south';
    res.json({ ok: true, seasons: await listTimetables(workspaceId) });
  } catch (err) {
    sendApiError(res, err);
  }
}
