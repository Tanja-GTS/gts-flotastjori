import path from 'node:path';
import dotenv from 'dotenv';

type ShiftServicesModule = {
  ensureShiftInstancesForMonth: (params: { workspaceId: string; month: string }) => Promise<{
    created: number;
    skipped: number;
    warnings: string[];
  }>;
};

type TimonSyncModule = {
  syncTimonShiftAssignments: (params: {
    workspaceId?: string;
    fromdate?: string;
    todate?: string;
    groups?: string;
    ssns?: string;
    dryRun?: boolean;
  }) => Promise<{
    summary: {
      workspaceId: string;
      dryRun: boolean;
      externalShiftCount: number;
      matchedShiftCount: number;
      assignedCount: number;
      unassignedCount: number;
      missingDriverCount: number;
      unmatchedCount: number;
    };
    warnings: string[];
  }>;
};

function getArg(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return '';
  return String(process.argv[idx + 1] || '').trim();
}

function asBool(value: string, fallback: boolean): boolean {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function addMonthsUtc(date: Date, deltaMonths: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + deltaMonths, date.getUTCDate()));
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatIsoMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function monthRange(month: string): { fromdate: string; todate: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Invalid month: ${month}`);

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { fromdate: formatIsoDate(start), todate: formatIsoDate(end) };
}

function listMonthsBetween(fromdate: string, todate: string): string[] {
  const from = new Date(`${fromdate}T00:00:00Z`);
  const to = new Date(`${todate}T00:00:00Z`);
  const months: string[] = [];

  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= end) {
    months.push(formatIsoMonth(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return months;
}

function resolveDateRange(): { fromdate: string; todate: string } {
  const month = getArg('--month') || process.env.TIMON_SYNC_MONTH || '';
  if (month) return monthRange(month);

  const explicitFrom = getArg('--fromdate') || process.env.TIMON_SYNC_FROMDATE || '';
  const explicitTo = getArg('--todate') || process.env.TIMON_SYNC_TODATE || '';
  if (explicitFrom && explicitTo) return { fromdate: explicitFrom, todate: explicitTo };

  const lookbackMonths = Math.max(0, Number(getArg('--lookback-months') || process.env.TIMON_SYNC_LOOKBACK_MONTHS || '1') || 1);
  const lookaheadMonths = Math.max(0, Number(getArg('--lookahead-months') || process.env.TIMON_SYNC_LOOKAHEAD_MONTHS || '0') || 0);
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - lookbackMonths, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + lookaheadMonths + 1, 0));
  return { fromdate: formatIsoDate(start), todate: formatIsoDate(end) };
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });

  const workspaceId = getArg('--workspace') || process.env.TIMON_SYNC_WORKSPACE || 'south';
  const dryRun = asBool(getArg('--dry-run') || process.env.TIMON_SYNC_DRY_RUN || '', false);
  const { fromdate, todate } = resolveDateRange();

  const shiftsImport = (await import('../services/shiftInstancesService.js')) as {
    default?: ShiftServicesModule;
    'module.exports'?: ShiftServicesModule;
  };
  const timonImport = (await import('../services/timonSyncService.js')) as {
    default?: TimonSyncModule;
    'module.exports'?: TimonSyncModule;
  };
  const shiftsModule =
    shiftsImport.default || shiftsImport['module.exports'] || (shiftsImport as unknown as ShiftServicesModule);
  const timonModule =
    timonImport.default || timonImport['module.exports'] || (timonImport as unknown as TimonSyncModule);

  const months = listMonthsBetween(fromdate, todate);
  const generationResults = [] as Array<{ month: string; created: number; skipped: number; warnings: number }>;
  for (const month of months) {
    const result = await shiftsModule.ensureShiftInstancesForMonth({ workspaceId, month });
    generationResults.push({ month, created: result.created, skipped: result.skipped, warnings: result.warnings.length });
  }

  const sync = await timonModule.syncTimonShiftAssignments({
    workspaceId,
    fromdate,
    todate,
    dryRun,
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        workspaceId,
        fromdate,
        todate,
        dryRun,
        generationResults,
        summary: sync.summary,
        warnings: sync.warnings,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});