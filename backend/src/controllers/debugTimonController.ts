import type { Request, Response } from 'express';
import { sendApiError } from './apiError';
import { getTimonReadiness, previewTimonShiftMatching } from '../services/timonPreviewService';
import type { ExternalShiftPlan } from '../services/timonService';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function getTimonReadinessDebug(_req: Request, res: Response) {
  try {
    const readiness = await getTimonReadiness();
    res.json({ ok: true, readiness });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function postTimonPreviewDebug(req: Request, res: Response) {
  try {
    const body = (req.body || {}) as {
      workspaceId?: string;
      shifts?: ExternalShiftPlan[];
      fromdate?: string;
      todate?: string;
      groups?: string;
      ssns?: string;
    };

    const preview = await previewTimonShiftMatching({
      workspaceId: asString(body.workspaceId) || asString(req.query.workspaceId) || 'south',
      shifts: Array.isArray(body.shifts) ? body.shifts : undefined,
      fromdate: asString(body.fromdate) || asString(req.query.fromdate),
      todate: asString(body.todate) || asString(req.query.todate),
      groups: asString(body.groups) || asString(req.query.groups),
      ssns: asString(body.ssns) || asString(req.query.ssns),
    });

    res.json({ ok: true, preview });
  } catch (err) {
    sendApiError(res, err);
  }
}
