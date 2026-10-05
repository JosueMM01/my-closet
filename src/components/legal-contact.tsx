import { APPROVED_PUBLIC_LEGAL_CONTACT, parseLegalContact } from '@/lib/legal-config';

// Server component: these two explicitly public fields are evaluated at build time.
export function LegalContact() {
  const contact = parseLegalContact({
    operatorName: process.env.PUBLIC_LEGAL_OPERATOR_NAME ?? APPROVED_PUBLIC_LEGAL_CONTACT.operatorName,
    contactEmail: process.env.PUBLIC_LEGAL_CONTACT_EMAIL ?? APPROVED_PUBLIC_LEGAL_CONTACT.contactEmail,
  });
  return (
    <section aria-labelledby="legal-contact" className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
      <h2 id="legal-contact" className="font-heading text-2xl">Responsable y contacto</h2>
      {contact.ready ? (
        <p className="mt-3 leading-7 text-text-secondary">
          Responsable: {contact.operatorName}. Para consultas de privacidad, acceso, corrección o eliminación de datos, escribe a{' '}
          <a className="break-all font-semibold text-primary underline" href={`mailto:${contact.contactEmail}`}>{contact.contactEmail}</a>.
          No incluyas contraseñas ni tokens en tu mensaje.
        </p>
      ) : (
        <p className="mt-3 leading-7 text-text-secondary">
          Los datos públicos del responsable y su correo de contacto están pendientes de confirmación.
          Estos documentos están en revisión y no están listos para la publicación de OAuth.
        </p>
      )}
    </section>
  );
}
