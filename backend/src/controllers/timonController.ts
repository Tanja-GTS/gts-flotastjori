import type { Request, Response } from 'express';
import { getTimonReadiness, previewTimonShiftMatching } from '../services/timonPreviewService';
import { syncTimonShiftAssignments } from '../services/timonSyncService';
import type { ExternalShiftPlan } from '../services/timonService';
import { cacheInvalidatePrefix } from '../services/simpleCache';
import { sendApiError } from './apiError';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBool(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  const raw = asString(value).toLowerCase();
  if (!raw) return defaultValue;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function readTimonBody(req: Request): {
  workspaceId?: string;
  shifts?: ExternalShiftPlan[];
  fromdate?: string;
  todate?: string;
  groups?: string;
  ssns?: string;
  dryRun?: boolean;
} {
  const body = (req.body || {}) as {
    workspaceId?: string;
    shifts?: ExternalShiftPlan[];
    fromdate?: string;
    todate?: string;
    groups?: string;
    ssns?: string;
    dryRun?: boolean | string;
  };

  return {
    workspaceId: asString(body.workspaceId) || asString(req.query.workspaceId) || 'south',
    shifts: Array.isArray(body.shifts) ? body.shifts : undefined,
    fromdate: asString(body.fromdate) || asString(req.query.fromdate),
    todate: asString(body.todate) || asString(req.query.todate),
    groups: asString(body.groups) || asString(req.query.groups),
    ssns: asString(body.ssns) || asString(req.query.ssns),
    dryRun: body.dryRun != null ? asBool(body.dryRun, true) : asBool(req.query.dryRun, true),
  };
}

export async function getTimonReadinessStatus(_req: Request, res: Response) {
  try {
    const readiness = await getTimonReadiness();
    res.json({ ok: true, readiness });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function postTimonPreview(req: Request, res: Response) {
  try {
    const params = readTimonBody(req);
    const preview = await previewTimonShiftMatching(params);
    res.json({ ok: true, preview });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function postTimonSync(req: Request, res: Response) {
  try {
    const params = readTimonBody(req);
    const result = await syncTimonShiftAssignments({ ...params, dryRun: params.dryRun !== false });
    if (!result.summary.dryRun) cacheInvalidatePrefix('shifts|');
    res.json({ ok: true, ...result });
  } catch (err) {
    sendApiError(res, err);
  }
}