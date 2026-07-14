import { Router, type Request, type Response } from 'express';
import { createElement } from 'react';
import { render } from '@react-email/render';
import { listHydratedShifts } from '../services/shiftInstancesService';
import { optionalEnv } from '../utils/env';
import DailyReport from '../emails/DailyReport';

export const reportRouter = Router();

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function tomorrowIso(): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
}
function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function scheduleLabel(shifts: any[]): string {
  const counts: Record<string, number> = {};
  for (const s of shifts) {
    const key = String(s.season || '').trim().toLowerCase();
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return 'Standard Schedule';
  const name = entries[0][0];
  return name.charAt(0).toUpperCase() + name.slice(1) + ' Schedule';
}

reportRouter.get('/preview', async (_req: Request, res: Response) => {
  const today    = todayIso();
  const tomorrow = tomorrowIso();
  const html = await render(createElement(DailyReport, {
    todayDate:      today,
    tomorrowDate:   tomorrow,
    todayShifts:    [
      { route: '51A', shiftType: 'morning', time: '06:00–11:45', driverId: 'x', driverName: 'Jón Sigurðsson' },
      { route: '51A', shiftType: 'evening', time: '14:30–23:00', driverId: 'y', driverName: 'Anna Björk' },
      { route: '51B', shiftType: 'morning', time: '06:30–15:00', driverId: null, driverName: null },
    ],
    tomorrowShifts: [
      { route: '51A', shiftType: 'morning', time: '06:00–11:45', driverId: 'x', driverName: 'Jón Sigurðsson' },
      { route: '51B', shiftType: 'evening', time: '14:35–23:00', driverId: 'y', driverName: 'Anna Björk' },
    ],
    todayLabel:     'Winter Schedule',
    tomorrowLabel:  'Summer Schedule',
  }));
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

reportRouter.post('/daily', async (_req: Request, res: Response) => {
  try {
    const apiKey      = optionalEnv('MAILERLITE_API_KEY', '');
    const to          = optionalEnv('DAILY_REPORT_TO', '');
    const fromEmail   = optionalEnv('DAILY_REPORT_FROM_EMAIL', 'noreply@gts.is');
    const fromName    = optionalEnv('DAILY_REPORT_FROM_NAME', 'Fleet Scheduler');
    const workspaceId = optionalEnv('DAILY_REPORT_WORKSPACE', 'south');

    if (!apiKey || !to) {
      res.json({ ok: false, reason: 'MAILERLITE_API_KEY or DAILY_REPORT_TO not configured' });
      return;
    }
    console.log(`[report] sending from=${fromEmail} to=${to} apiKeyPrefix=${apiKey.slice(0, 8)}`);

    const today    = todayIso();
    const tomorrow = tomorrowIso();
    const months   = [...new Set([today.slice(0, 7), tomorrow.slice(0, 7)])];
    const allShifts = (await Promise.all(months.map((m) => listHydratedShifts({ workspaceId, month: m })))).flat();

    const shiftsFor = (date: string) =>
      allShifts.filter((s: any) => s.date?.slice(0, 10) === date)
               .sort((a: any, b: any) => (a.route + a.shiftType).localeCompare(b.route + b.shiftType));

    const todayShifts    = shiftsFor(today);
    const tomorrowShifts = shiftsFor(tomorrow);
    const totalUnassigned = [...todayShifts, ...tomorrowShifts].filter((s: any) => !s.driverId).length;

    const subject = totalUnassigned === 0
      ? `✅ All shifts assigned — ${formatDate(today)}`
      : `⚠️ ${totalUnassigned} unassigned — ${formatDate(today)}`;

    const html = await render(createElement(DailyReport, {
      todayDate:      today,
      tomorrowDate:   tomorrow,
      todayShifts,
      tomorrowShifts,
      todayLabel:     scheduleLabel(todayShifts),
      tomorrowLabel:  scheduleLabel(tomorrowShifts),
    }));

    const mailRes = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: { email: fromEmail, name: fromName },
        to: [{ email: to }],
        subject,
        html,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!mailRes.ok) {
      const body = await mailRes.text();
      res.status(500).json({ ok: false, reason: `MailerSend ${mailRes.status}: ${body}` });
      return;
    }

    console.log(`[report] Daily email sent to ${to} — ${subject}`);
    res.json({ ok: true, subject });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, reason: msg });
  }
});
