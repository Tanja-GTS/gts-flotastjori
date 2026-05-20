import type { Request, Response } from 'express';
import { ensureShiftInstancesForMonth, listHydratedShifts } from '../services/shiftInstancesService';
import { cacheGetOrSet, cacheInvalidatePrefix } from '../services/simpleCache';
import { syncTimonShiftAssignments } from '../services/timonSyncService';
import { sendApiError } from './apiError';

const SHIFTS_TTL_MS = Number(process.env.CACHE_SHIFTS_TTL_MS || 15000);
const AUTO_GENERATE_ON_READ = !['false', '0', 'no', 'off'].includes(
  String(process.env.AUTO_GENERATE_SHIFTS_ON_READ || 'true').trim().toLowerCase()
);
const AUTO_TIMON_SYNC_ON_READ = !['false', '0', 'no', 'off'].includes(
  String(process.env.AUTO_TIMON_SYNC_ON_READ || 'false').trim().toLowerCase()
);
const AUTO_TIMON_SYNC_COOLDOWN_MS = Math.max(0, Number(process.env.AUTO_TIMON_SYNC_COOLDOWN_MS || 1800000) || 1800000);

function monthDateRange(month: string): { fromdate: string; todate: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return null;

  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  const format = (value: Date) => value.toISOString().slice(0, 10);

  return { fromdate: format(start), todate: format(end) };
}

export async function getShifts(req: Request, res: Response) {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const workspaceId =
      typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

    if (date) {
      // We can support date-level filtering later; for now keep it simple.
      // Most UI operations are month/week based.
    }

    const cacheKey = `shifts|${workspaceId || 'all'}|${month || 'all'}`;

    if (AUTO_TIMON_SYNC_ON_READ && workspaceId && month) {
      const range = monthDateRange(month);
      if (range) {
        const syncKey = `timon-auto-sync|${workspaceId}|${month}`;
        const syncResult = await cacheGetOrSet({
          key: syncKey,
          ttlMs: AUTO_TIMON_SYNC_COOLDOWN_MS,
          factory: () =>
            syncTimonShiftAssignments({
              workspaceId,
              fromdate: range.fromdate,
              todate: range.todate,
              dryRun: false,
            }),
        });

        if (syncResult.summary.matchedShiftCount > 0 || syncResult.summary.unmatchedCount > 0) {
          cacheInvalidatePrefix(cacheKey);
        }
        if (syncResult.warnings.length > 0) {
          console.warn(
            `[shifts] Timon auto-sync warnings for ${workspaceId} ${month}:\n${syncResult.warnings.join('\n')}`
          );
        }
      }
    }

    const t0 = Date.now();
    const shifts = await cacheGetOrSet({
      key: cacheKey,
      ttlMs: SHIFTS_TTL_MS,
      factory: async () => {
        const ft0 = Date.now();
        let prefetchedInstances;
        if (AUTO_GENERATE_ON_READ && workspaceId && month) {
          const result = await ensureShiftInstancesForMonth({ workspaceId, month });
          console.log(`[shifts] ensureShiftInstances ${workspaceId} ${month}: ${Date.now() - ft0}ms (created=${result.created}, found=${result.instances.length})`);
          if (result.warnings.length > 0) {
            console.warn(
              `[shifts] auto-generation warnings for ${workspaceId} ${month}:\n${result.warnings.join('\n')}`
            );
          }
          if (result.created === 0) prefetchedInstances = result.instances;
        }
        const ht0 = Date.now();
        const hydrated = await listHydratedShifts({ month, workspaceId, prefetchedInstances });
        console.log(`[shifts] hydrate ${workspaceId} ${month}: ${Date.now() - ht0}ms → total factory ${Date.now() - ft0}ms`);
        return hydrated;
      },
    });
    console.log(`[shifts] GET ${workspaceId} ${month}: ${Date.now() - t0}ms (cached=${Date.now() - t0 < 5})`);
    res.json({ ok: true, shifts });
  } catch (err) {
    sendApiError(res, err);
  }
}
