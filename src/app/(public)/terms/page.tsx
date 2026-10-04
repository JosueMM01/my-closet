import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL_REVISED_ON } from '@/lib/legal-config';

export const metadata: Metadata = { title: 'Términos de uso', description: 'Condiciones de acceso y uso personal de My Closet, sincronización y fotografías.' };

const sections = [
  ['Acceso y cuenta', 'My Closet es una aplicación de uso personal y acceso por invitación. Debes utilizar la cuenta y el correo autorizados, proporcionar información correcta y mantener tus credenciales seguras. No compartas invitaciones ni intentes acceder a cuentas ajenas. Google Sign-In es opcional y no sustituye la autorización para crear una cuenta.'],
  ['Uso permitido y tus fotografías', 'Solo sube fotografías y contenido propios o para los que tengas permiso. Conservas tus derechos sobre ellos y autorizas su almacenamiento y procesamiento exclusivamente para las funciones de la aplicación. No subas contenido ilegal, información sensible innecesaria o material que vulnere derechos de otras personas. No intentes eludir permisos, extraer datos ajenos o interferir con el servicio.'],
  ['Sincronización y disponibilidad', 'El funcionamiento offline depende de los datos y recursos que tu navegador haya guardado. Los cambios pendientes requieren conexión y sesión válida para sincronizarse; no son todavía un respaldo remoto. No borres el almacenamiento local antes de confirmar la sincronización. El servicio utiliza planes gratuitos y puede experimentar límites, pausas, mantenimiento o interrupciones. No se garantiza disponibilidad ininterrumpida ni un plazo fijo de recuperación.'],
  ['Edición de imágenes y sugerencias', 'La eliminación automática de fondo puede tardar, fallar o producir resultados imperfectos según la imagen y el dispositivo. Puedes conservar la fotografía y editarla manualmente. Las sugerencias de ropa son orientativas; no aseguran un resultado estético ni sustituyen tu criterio. Guarda por separado las fotografías originales que quieras conservar.'],
  ['Compartir y eliminar', 'Compartir un elemento puede permitir que otras personas vean sus datos mediante un enlace. Las URLs de imágenes pueden ser accesibles por quien las conozca. Revocar un enlace no retira copias que otros hayan guardado. Borrar una prenda no implica necesariamente la eliminación inmediata de todos sus archivos o versiones en respaldos. La baja automática completa aún no está disponible; solicita la eliminación al responsable.'],
  ['Seguridad, suspensión y cambios', 'El responsable puede deshabilitar una cuenta por uso indebido o necesidad de seguridad. Comunica incidentes sin enviar contraseñas ni tokens. Estos términos se revisarán cuando cambie el servicio; se indicará la fecha y se comunicarán cambios relevantes. Estos textos no pretenden excluir derechos que resulten aplicables por ley.'],
] as const;

export default function TermsPage() {
  return (
    <article>
      <p className="text-sm font-semibold uppercase tracking-[0.15em] text-primary">Información pública</p>
      <h1 className="mt-4 font-heading text-4xl leading-tight sm:text-5xl">Términos de uso</h1>
      <p className="mt-4 text-sm text-text-secondary">Revisión: {LEGAL_REVISED_ON}.</p>
      <p className="mt-6 text-lg leading-8 text-text-secondary">Lee estas condiciones antes de utilizar My Closet. El tratamiento de datos se explica en la <Link href="/privacy" prefetch={false} className="text-primary underline">política de privacidad</Link>.</p>
      <div className="mt-10 space-y-9">
        {sections.map(([title, content]) => (
          <section key={title}>
            <h2 className="font-heading text-2xl">{title}</h2>
            <p className="mt-3 leading-8 text-text-secondary">{content}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
