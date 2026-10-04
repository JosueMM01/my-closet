import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sobre la aplicación',
  description: 'My Closet es un armario digital personal con prendas, conjuntos y calendario. Acceso mediante invitación.',
};

export default function AboutPage() {
  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Tu armario, a tu ritmo</p>
      <h1 className="mt-5 max-w-2xl font-heading text-4xl leading-tight sm:text-6xl">Menos buscar.<br />Más combinar.</h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-text-secondary">
        My Closet te ayuda a organizar tus prendas, guardar conjuntos y planear qué vestir.
        Una aplicación de uso personal, con acceso mediante invitación.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          ['Tu armario', 'Fotografías, colores, favoritos y notas para reconocer lo que ya tienes.'],
          ['Tus combinaciones', 'Conjuntos y sugerencias locales por ocasión, estilo y clima indicado por ti.'],
          ['A tu alcance', 'Datos guardados en el navegador y sincronización cuando la conexión y la sesión lo permiten.'],
        ].map(([title, description]) => (
          <section key={title} className="rounded-3xl border border-border bg-surface p-6">
            <h2 className="font-heading text-2xl">{title}</h2>
            <p className="mt-3 text-sm leading-7 text-text-secondary">{description}</p>
          </section>
        ))}
      </div>
      <p className="mt-8 leading-7 text-text-secondary">
        La edición y eliminación de fondo se realizan en tu dispositivo. El modelo se descarga cuando se necesita
        y puede reutilizarse desde la caché. Las fotos guardadas se sincronizan con Cloudinary;
        los datos de cuenta y armario se conservan en Neon. Vercel aloja la aplicación.
        No es un servicio de prueba virtual de ropa ni genera imágenes de personas.
      </p>
      <Link href="/login" prefetch={false} className="mt-8 inline-flex min-h-12 items-center rounded-full bg-primary px-7 font-semibold text-white hover:bg-primary-hover">Entrar a My Closet</Link>
      <p className="mt-4 text-sm leading-6 text-text-secondary">¿Tienes una invitación? Utiliza el enlace que recibiste. El registro público está deshabilitado.</p>
    </>
  );
}
