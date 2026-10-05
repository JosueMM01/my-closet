import type { Metadata } from 'next';
import { LEGAL_REVISED_ON } from '@/lib/legal-config';

export const metadata: Metadata = { title: 'Política de privacidad', description: 'Cómo My Closet utiliza, almacena y protege los datos de cuenta, armario e imágenes.' };

const sections = [
  ['Cuenta e invitaciones', 'Un administrador indica el correo destinatario y el rol al crear una invitación. Para aceptar con contraseña, proporcionas tu nombre y una contraseña; el correo procede de la invitación y no puede sustituirse por otro. También puedes aceptar con Google si entrega ese mismo correo verificado. Conservamos nombre, correo, rol, estado de cuenta, fotografía de perfil y la información necesaria para gestionar la invitación y su caducidad. Las contraseñas se almacenan como hashes, no en texto legible. No solicitamos datos biométricos.'],
  ['Datos de tu armario', 'Guardamos los datos que decides introducir: prendas y sus fotografías, categorías, marcas, tallas, colores, notas, favoritos, conjuntos y planificación en el calendario. También conservamos identificadores, fechas, versiones y marcadores de borrado necesarios para sincronizar tus dispositivos. Para operar el servicio y detectar fallos utilizamos información de sesiones y registros técnicos de las solicitudes.'],
  ['Para qué se utilizan', 'Para darte acceso, organizar y sincronizar tu armario, gestionar invitaciones, recuperar el acceso, compartir elementos cuando lo solicitas y mantener la seguridad y los respaldos. Las sugerencias de conjuntos son locales y deterministas; no enviamos tu armario a un servicio de IA generativa.'],
  ['Iniciar sesión con Google', 'El inicio de sesión con Google es opcional. Solicitamos únicamente los permisos de identidad openid, email y profile: identificador de cuenta, correo y su verificación, nombre y fotografía de perfil, cuando Google los proporciona. Se utilizan para identificarte, crear tu cuenta al aceptar una invitación válida, vincular el acceso y facilitar tu perfil. Puedes cambiar tu fotografía desde Perfil. No solicitamos acceso a tus mensajes, contactos o archivos ni permiso para publicar en tu nombre. No vinculamos cuentas existentes únicamente porque coincida el correo; la vinculación se realiza explícitamente desde Perfil.'],
  ['Cookies y almacenamiento en tu dispositivo', 'Utilizamos cookies de sesión y cookies temporales necesarias para OAuth, no cookies publicitarias. La cookie de sesión es HttpOnly, SameSite=Lax y Secure en producción. IndexedDB guarda tu perfil local, armario, fotografías y operaciones pendientes para trabajar sin conexión; no guarda el token de sesión. El navegador también puede guardar recursos y modelos en caché. Borrar datos del sitio puede eliminar borradores y operaciones aún no sincronizadas. Evita dispositivos compartidos o públicos.'],
  ['Fotografías y procesamiento local', 'La conversión, edición y eliminación de fondo se ejecutan en el navegador, no en nuestros servidores. Descargar el modelo y sincronizar imágenes consume datos; la caché puede evitar descargas posteriores, pero puede ser eliminada por el navegador. Un borrador sin guardar no debe subirse como una prenda. Al guardar y sincronizar, las fotografías se alojan en Cloudinary. Las URLs de imágenes no equivalen a un almacenamiento privado: quien conozca una URL de entrega puede acceder a la imagen. No subas documentos ni fotografías sensibles.'],
  ['Proveedores y datos de Google', 'Vercel aloja la aplicación; Neon conserva la base de datos; Cloudinary almacena las imágenes; Google proporciona el inicio de sesión opcional y Gmail SMTP entrega los correos. Los respaldos internos se guardan en Google, sin solicitar permisos adicionales a tu cuenta. No vendemos datos personales ni utilizamos los datos obtenidos de Google para publicidad o entrenamiento de modelos. Los proveedores pueden procesar datos fuera de tu país según sus condiciones y ubicación del servicio.'],
  ['Retención, eliminación y respaldos', 'Conservamos los datos mientras la cuenta y el servicio los necesiten. Puedes solicitar acceso, corrección o eliminación al responsable mediante el contacto indicado. El borrado puede conservar marcadores de sincronización y no elimina inmediatamente todos los archivos ni copias históricas; la baja automática completa todavía no está disponible. Los respaldos cifrados de la base de datos conservan las dos últimas generaciones, con un intervalo previsto de ocho días; la automatización continua aún está en validación. No incluyen las imágenes de Cloudinary ni cambios pendientes que solo existan en tu dispositivo. Los datos históricos permanecen hasta la rotación de las copias.'],
  ['Seguridad y cambios', 'Aplicamos controles de sesión, permisos de acceso y validación de datos. Ningún sistema puede garantizar seguridad absoluta; no compartas contraseñas, enlaces de invitación ni enlaces públicos. Esta política debe actualizarse cuando cambien las funciones, proveedores o prácticas de retención. Se indicará la fecha de revisión y se comunicarán cambios relevantes a las personas afectadas.'],
] as const;

export default function PrivacyPage() {
  return (
    <article>
      <p className="text-sm font-semibold uppercase tracking-[0.15em] text-primary">Información pública</p>
      <h1 className="mt-4 font-heading text-4xl leading-tight sm:text-5xl">Política de privacidad</h1>
      <p className="mt-4 text-sm text-text-secondary">Revisión: {LEGAL_REVISED_ON}.</p>
      <p className="mt-6 text-lg leading-8 text-text-secondary">Esta política describe el funcionamiento actual de My Closet, un armario digital personal con acceso mediante invitación.</p>
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
