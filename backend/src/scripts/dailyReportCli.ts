import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function optionalEnv(key: string, fallback = '') {
  return (process.env[key] || fallback).trim();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function sendBrevoEmail(params: {
  apiKey: string;
  from: { email: string; name?: string };
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': params.apiKey,
    },
    body: JSON.stringify({
      sender: { email: params.from.email, name: params.from.name || 'Fleet Scheduler' },
      to: [{ email: params.to }],
      subject: params.subject,
      htmlContent: params.html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo error ${res.status}: ${body}`);
  }
}

async function main() {
  const apiKey = optionalEnv('BREVO_API_KEY');
  const to = optionalEnv('DAILY_REPORT_TO');
  const fromEmail = optionalEnv('DAILY_REPORT_FROM_EMAIL', 'noreply@gts.is');
  const fromName = optionalEnv('DAILY_REPORT_FROM_NAME', 'Fleet Scheduler');
  const workspaceId = optionalEnv('DAILY_REPORT_WORKSPACE', 'south');

  if (!apiKey) { console.error('[daily-report] BREVO_API_KEY not set — skipping'); process.exit(0); }
  if (!to)     { console.error('[daily-report] DAILY_REPORT_TO not set — skipping'); process.exit(0); }

  const { listHydratedShifts } = await import('../services/shiftInstancesService.js') as any;

  const today = todayIso();
  const month = today.slice(0, 7);
  const allShifts: any[] = await listHydratedShifts({ workspaceId, month });
  const todayShifts = allShifts
    .filter((s: any) => s.date?.slice(0, 10) === today)
    .sort((a: any, b: any) => (a.route + a.shiftType).localeCompare(b.route + b.shiftType));

  const unassigned = todayShifts.filter((s: any) => !s.driverId);
  const assigned   = todayShifts.filter((s: any) =>  s.driverId);
  const allGood    = unassigned.length === 0;

  const LABEL: Record<string, string> = { morning: 'Morning', evening: 'Evening', single: 'Single' };

  function shiftRow(s: any, ok: boolean): string {
    const type = LABEL[s.shiftType] || s.shiftType;
    const driver = s.driverName || '—';
    const color = ok ? '#1a7f37' : '#b91c1c';
    const status = ok ? driver : '⚠️ Unassigned';
    return `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600">${s.route}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">${type}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">${s.time || ''}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;color:${color};font-weight:${ok ? '400' : '700'}">${status}</td>
      </tr>`;
  }

  const tableHeader = `
    <tr style="background:#f5f5f5">
      <th style="padding:8px 12px;text-align:left">Route</th>
      <th style="padding:8px 12px;text-align:left">Type</th>
      <th style="padding:8px 12px;text-align:left">Time</th>
      <th style="padding:8px 12px;text-align:left">Driver</th>
    </tr>`;

  const unassignedRows = unassigned.map((s: any) => shiftRow(s, false)).join('');
  const assignedRows   = assigned.map((s: any) => shiftRow(s, true)).join('');

  const summaryColor = allGood ? '#1a7f37' : '#b91c1c';
  const summaryText  = allGood
    ? `✅ All ${todayShifts.length} shifts are assigned`
    : `⚠️ ${unassigned.length} unassigned shift${unassigned.length > 1 ? 's' : ''} out of ${todayShifts.length}`;

  const unassignedSection = unassigned.length > 0 ? `
    <h3 style="color:#b91c1c;margin-top:24px">Unassigned shifts</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${tableHeader}${unassignedRows}
    </table>` : '';

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="margin-bottom:4px">Daily Shift Report</h2>
      <p style="color:#666;margin-top:0">${formatDate(today)}</p>
      <p style="font-size:16px;font-weight:700;color:${summaryColor}">${summaryText}</p>
      ${unassignedSection}
      <h3 style="margin-top:24px">All shifts today</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${tableHeader}${unassignedRows}${assignedRows}
      </table>
      <p style="color:#aaa;font-size:12px;margin-top:24px">Fleet Scheduler — automated daily report</p>
    </div>`;

  const subject = allGood
    ? `✅ All shifts assigned — ${formatDate(today)}`
    : `⚠️ ${unassigned.length} unassigned — ${formatDate(today)}`;

  await sendBrevoEmail({ apiKey, from: { email: fromEmail, name: fromName }, to, subject, html });
  console.log(`[daily-report] Email sent to ${to} — ${summaryText}`);
}

main().catch((err) => {
  console.error('[daily-report] Failed:', err);
  process.exit(1);
});
