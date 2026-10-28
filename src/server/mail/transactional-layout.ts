/** Inline styles and presentation tables work without remote assets or tracking. */
export function escapeEmailHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function transactionalEmailLayout(input: {
  title: string;
  preheader: string;
  /** Only server-authored markup; escape every interpolated value at the caller. */
  contentHtml: string;
}): string {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeEmailHtml(input.title)} · My Closet</title></head>
<body style="margin:0;padding:0;background-color:#FAF8F6;color:#24201F;font-family:Verdana,Geneva,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeEmailHtml(input.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#FAF8F6">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#FFFFFF;border:1px solid #EAE3DE;border-radius:18px">
        <tr><td style="padding:32px 28px 20px;border-top:4px solid #8F5B66">
          <p style="margin:0 0 26px;color:#8F5B66;font-size:12px;font-weight:bold;letter-spacing:3px">MY CLOSET</p>
          <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:normal;line-height:1.25">${escapeEmailHtml(input.title)}</h1>
        </td></tr>
        <tr><td style="padding:0 28px 28px;font-size:14px;line-height:1.8;color:#625B58">${input.contentHtml}</td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #EAE3DE;background-color:#FBF8F7;font-size:12px;line-height:1.7;color:#746B68">
          Tu armario es personal. No compartas contraseñas, códigos ni enlaces de seguridad.
        </td></tr>
      </table>
      <p style="margin:22px 0 0;color:#8B807B;font-size:11px;line-height:1.6">My Closet · Cuenta y seguridad</p>
      <p style="margin:4px 0 0;color:#8B807B;font-family:Georgia,serif;font-size:13px">Tu armario digital, siempre contigo.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function emailActionButton(label: string, url: string): string {
  if (!['https:', 'http:'].includes(new URL(url).protocol)) {
    throw new Error('El enlace del correo debe usar HTTP o HTTPS');
  }
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td align="center" bgcolor="#7A4D57" style="background-color:#7A4D57;border-radius:10px">
    <a href="${escapeEmailHtml(url)}" style="display:inline-block;padding:15px 24px;border:1px solid #7A4D57;border-radius:10px;color:#FFFFFF;font-size:14px;font-weight:bold;line-height:1.4;text-decoration:none">${escapeEmailHtml(label)}</a>
  </td></tr></table>`;
}
