/**
 * Envoi d emails transactionnels via Resend.
 *
 * Un seul email existe aujourd hui — le lien de connexion — mais la separation
 * entre *composer* et *envoyer* est deliberee : la composition est pure, donc
 * testable sans reseau, et c est la partie ou une erreur se voit (un lien
 * casse, une date fausse, du HTML mal echappe).
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Expediteur par defaut : le domaine de test de Resend, verifie d office. */
export const DEFAULT_MAIL_FROM = 'Crea <onboarding@resend.dev>';

export interface MailerEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

/** Sans cle API, aucun email ne peut partir : autant le dire franchement. */
export function isMailerConfigured(env: MailerEnv): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

/** Expediteur effectif, valeur par defaut comprise. */
export function mailFrom(env: MailerEnv): string {
  return env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM;
}

/**
 * Echappe le texte insere dans le HTML.
 *
 * Le lien est construit par nos soins, mais il transporte un jeton aleatoire :
 * une seule esperluette non echappee suffirait a le tronquer dans certains
 * clients mail, et le lien deviendrait invalide sans que rien ne le signale.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Duree de validite restante, arrondie a la minute, jamais negative. */
export function minutesUntil(expiresAt: number, now: Date): number {
  const seconds = expiresAt - Math.floor(now.getTime() / 1000);
  return Math.max(0, Math.round(seconds / 60));
}

/**
 * Compose le message portant le lien de connexion.
 *
 * `now` est un parametre plutot qu un appel a `Date.now()` : le rendu reste
 * ainsi deterministe, donc verifiable par un test.
 */
export function buildMagicLinkEmail({
  link,
  expiresAt,
  now = new Date(),
}: {
  link: string;
  expiresAt: number;
  now?: Date;
}): EmailContent {
  const minutes = minutesUntil(expiresAt, now);
  const safeLink = escapeHtml(link);
  const validite = `Ce lien est valable ${minutes} minutes et ne fonctionne qu une seule fois.`;

  const text = [
    'Votre lien de connexion a Crea',
    '',
    link,
    '',
    validite,
    'Si vous n avez pas demande ce lien, ignorez ce message.',
  ].join('\n');

  // Styles en ligne : les clients mail ignorent les feuilles externes, et la
  // plupart suppriment meme les balises <style> du <head>.
  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:32px 16px;background:#F5F2EA;font-family:Georgia,'Times New Roman',serif;color:#2F3E34;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FDFBF6;border:1px solid #E3DCCB;border-radius:4px;">
      <tr>
        <td style="padding:40px 40px 32px;">
          <p style="margin:0 0 24px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8A9A85;font-family:Helvetica,Arial,sans-serif;">Crea</p>

          <h1 style="margin:0 0 20px;font-size:26px;font-weight:400;line-height:1.3;color:#2F3E34;">Votre lien de connexion</h1>

          <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#5A6B57;">
            Ouvrez le builder en un clic. Aucun mot de passe a retenir.
          </p>

          <p style="margin:0 0 28px;">
            <a href="${safeLink}" style="display:inline-block;padding:14px 28px;background:#2F3E34;color:#FDFBF6;font-family:Helvetica,Arial,sans-serif;font-size:15px;text-decoration:none;border-radius:3px;">Se connecter</a>
          </p>

          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#8A9A85;font-family:Helvetica,Arial,sans-serif;">
            ${escapeHtml(validite)}
          </p>
          <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#8A9A85;font-family:Helvetica,Arial,sans-serif;">
            Si vous n avez pas demande ce lien, ignorez ce message.
          </p>

          <hr style="border:none;border-top:1px solid #E3DCCB;margin:0 0 20px;" />

          <p style="margin:0;font-size:12px;line-height:1.6;color:#A89968;font-family:Helvetica,Arial,sans-serif;word-break:break-all;">
            Le bouton ne fonctionne pas ? Copiez cette adresse :<br />${safeLink}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: 'Votre lien de connexion a Crea', text, html };
}

/**
 * Compose la notification d une demande recue par un formulaire.
 *
 * Les valeurs viennent d un visiteur inconnu : tout passe par `escapeHtml`.
 * L adresse de l expediteur, quand elle est fournie, devient le `reply-to` du
 * message — repondre a une demande doit se faire d un geste.
 */
export function buildContactEmail({
  siteTitle,
  fields,
  senderName,
}: {
  siteTitle: string;
  fields: Array<{ label: string; value: string }>;
  senderName?: string | null;
}): EmailContent {
  const subject = senderName
    ? `Nouvelle demande de ${senderName} — ${siteTitle}`
    : `Nouvelle demande — ${siteTitle}`;

  const text = [
    `Demande recue depuis ${siteTitle}.`,
    '',
    ...fields.map(({ label, value }) => `${label} : ${value}`),
  ].join('\n');

  const rows = fields
    .map(
      ({ label, value }) => `<tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#8A9A85;white-space:nowrap;">${escapeHtml(label)}</td>
        <td style="padding:8px 0;vertical-align:top;font-size:15px;line-height:1.6;color:#2F3E34;white-space:pre-wrap;">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:32px 16px;background:#F5F2EA;font-family:Georgia,'Times New Roman',serif;color:#2F3E34;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FDFBF6;border:1px solid #E3DCCB;border-radius:4px;">
      <tr>
        <td style="padding:36px 40px;">
          <p style="margin:0 0 20px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8A9A85;font-family:Helvetica,Arial,sans-serif;">${escapeHtml(siteTitle)}</p>
          <h1 style="margin:0 0 24px;font-size:24px;font-weight:400;line-height:1.3;">Nouvelle demande</h1>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${rows}</table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export class MailError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MailError';
    this.status = status;
  }
}

/**
 * Extrait le message d erreur d une reponse Resend.
 * Le corps peut etre du JSON structure, du texte brut, ou vide selon la panne :
 * les trois cas produisent une phrase exploitable dans les journaux.
 */
export function readMailError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown; name?: unknown };
    const message = parsed.message ?? parsed.error ?? parsed.name;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    /* corps non JSON : on retombe sur le texte brut. */
  }

  const raw = body.trim().slice(0, 200);
  return raw || `Resend a repondu ${status} sans detail.`;
}

/** Envoie un message. Leve `MailError` si Resend refuse. */
export async function sendEmail(
  env: MailerEnv,
  { to, subject, text, html, replyTo }: EmailContent & { to: string; replyTo?: string | null },
): Promise<void> {
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY?.trim() ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: mailFrom(env),
      to: [to],
      subject,
      text,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!response.ok) {
    throw new MailError(readMailError(response.status, await response.text()), response.status);
  }
}
