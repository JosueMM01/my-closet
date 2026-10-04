import type { Metadata } from 'next';
import { LEGAL_REVISED_ON } from '@/lib/legal-config';

export const metadata: Metadata = { title: 'Política de privacidad', description: 'Cómo My Closet utiliza, almacena y protege los datos de cuenta, armario e imágenes.' };

const sections = [
  ['Qué datos utilizamos', 'Nombre, correo, rol, estado de cuenta y fotografía de perfil; prendas, fotografías, colores, notas, favoritos, conjuntos y calendario. Conservamos credenciales de acceso protegidas mediante hash, sesiones e invitaciones y registros técnicos necesarios para operar y detectar fallos. No solicitamos datos biométricos.'],
  ['Para qué se utilizan', 'Para darte acceso, organizar y sincronizar tu armario, gestionar invitaciones, recuperar el acceso, compartir elementos cuando lo solicitas y mantener la seguridad y los respaldos. Las sugerencias de conjuntos son locales y deterministas; no enviamos tu armario a un servicio de IA generativa.'],
  ['Google Sign-In', 'Si eliges Google, solicitamos identidad básica: identificador de cuenta, correo verificado, nombre y foto de perfil. No pedimos acceso a tu Gmail, contactos o Drive para iniciar sesión. Google no crea cuentas sin una invitación válida y no vinculamos cuentas existentes únicamente porque coincida el correo. Una cuenta existente puede vincular Google desde Perfil.'],
  ['Cookies y almacenamiento en tu dispositivo', 'Utilizamos cookies de sesión y cookies temporales necesarias para OAuth, no cookies publicitarias. La cookie de sesión es HttpOnly, SameSite=Lax y Secure en producción. IndexedDB guarda tu perfil local, armario, fotografías y operaciones pendientes para trabajar sin conexión; no guarda el token de sesión. El navegador también puede guardar recursos y modelos en caché. Borrar datos del sitio puede eliminar borradores y operaciones aún no sincronizadas. Evita dispositivos compartidos o públicos.'],
  ['Fotografías y procesamiento local', 'La conversión, edición y eliminación de fondo se ejecutan en el navegador, no en nuestros servidores. Descargar el modelo y sincronizar imágenes consume datos; la caché puede evitar descargas posteriores, pero puede ser eliminada por el navegador. Un borrador sin guardar no debe subirse como una prenda. Al guardar y sincronizar, las fotografías se alojan en Cloudinary. Las URLs de imágenes no equivalen a un almacenamiento privado: quien conozca una URL de entrega puede acceder a la imagen. No subas documentos ni fotografías sensibles.'],
  ['Proveedores y datos de Google', 'Vercel aloja la aplicación y procesa solicitudes y registros técnicos; Neon conserva la base de datos; Cloudinary almacena las imágenes; Gmail SMTP entrega invitaciones y mensajes de recuperación. Una cuenta del responsable en Google Drive guarda copias cifradas de la base de datos; no accedemos al Drive de los usuarios. No vendemos datos personales ni utilizamos los datos obtenidos de Google para publicidad o entrenamiento de modelos. Su uso se limita a las funciones descritas. Los proveedores pueden procesar datos fuera de tu país según sus condiciones y ubicación del servicio.'],
  ['Retención, eliminación y respaldos', 'Conservamos los datos mientras la cuenta y el servicio los necesiten. Eliminar una prenda puede conservar un marcador de borrado para sincronizar dispositivos y no garantiza la eliminación inmediata del archivo en Cloudinary; la limpieza automática de imágenes y la baja completa de cuenta siguen en desarrollo. Puedes solicitar acceso, corrección o eliminación al responsable. La política de respaldo es una copia cifrada cada ocho días y dos generaciones completas; se ha probado restauración y rotación, pero la automatización continua sigue en validación. Las copias no incluyen los binarios de Cloudinary ni borradores locales y pueden conservar datos históricos hasta su rotación.'],
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
