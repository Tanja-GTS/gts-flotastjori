import path from 'node:path';
import dotenv from 'dotenv';
import { generateShiftInstances } from '../services/shiftInstancesService';

function getArg(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return '';
  return String(process.argv[idx + 1] || '').trim();
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });

  const month = getArg('--month');
  const workspaceId = getArg('--workspace');

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('Missing/invalid --month. Example: --month 2026-02');
  }
  if (!workspaceId) {
    throw new Error('Missing --workspace. Example: --workspace south');
  }

  const result = await generateShiftInstances({ month, workspaceId });
  // eslint-disable-next-line no-console
  console.log(`Done. Created ${result.created}, skipped ${result.skipped}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
