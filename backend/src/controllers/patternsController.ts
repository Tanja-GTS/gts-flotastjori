import type { Request, Response } from 'express';
import { listShiftPatterns } from '../services/shiftPatternsService';
import { cacheGetOrSet } from '../services/simpleCache';
import { sendApiError } from './apiError';

const PATTERNS_TTL_MS = Number(process.env.CACHE_PATTERNS_TTL_MS || 10 * 60 * 1000);

export async function getPatterns(req: Request, res: Response) {
  try {
    const workspaceId =
      typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

    const patterns = await cacheGetOrSet({
      key: `patterns|${workspaceId || 'all'}`,
      ttlMs: PATTERNS_TTL_MS,
      factory: () => listShiftPatterns({ workspaceId }),
    });
    res.json({ ok: true, patterns });
  } catch (err) {
    sendApiError(res, err);
  }
}
