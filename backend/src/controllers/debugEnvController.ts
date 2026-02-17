import type { Request, Response } from 'express';
import { optionalEnv } from '../utils/env';

export function getEnvDebug(_req: Request, res: Response) {
  const mailSenderUpn = optionalEnv('MAIL_SENDER_UPN', '').trim();
  const appOrigin = optionalEnv('APP_ORIGIN', '').trim();

  res.json({
    ok: true,
    mailSenderUpn: mailSenderUpn || null,
    mailSenderUpnSet: Boolean(mailSenderUpn),
    appOrigin: appOrigin || null,
  });
}
