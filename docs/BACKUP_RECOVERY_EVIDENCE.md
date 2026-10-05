# Ensayo de recuperación — 4A

Fecha: 2026-10-04, aproximadamente 13:17–13:18, America/Mexico_City.
Código de respaldos: corrección `8d278c2` (equivalente a `22bf2c7` en la rama
anterior). Ensayo local autorizado, no ejecución de GitHub Actions.

## Resultado

- Fuente: rama Neon main, endpoint directo y TLS verificados antes del dump.
- Herramientas: PostgreSQL 18.6 y age 1.3.2. Binario age obtenido del release
  oficial, SHA-256 contrastado con el digest publicado. Sin instalación global.
- Docker: imagen oficial `postgres:18-alpine`, digest
  `sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`.
- Dump consistente desde snapshot exportado en transacción repeatable-read,
  solo lectura. La aplicación no se puso en mantenimiento.
- Tres generaciones cifradas del ensayo; la rotación dejó únicamente las dos
  últimas parejas archivo/manifiesto. Se usó el mismo dump para ejercitar la
  retención: no representa tres días históricos de producción.
- Copia restaurada: `my-closet-20261004T191820485Z.dump.age`, 49 835 bytes.
  Drive confirmó tamaño/MD5; SHA-256 comprobado al descargar y tras descifrar.
- Restauración únicamente en rama temporal nueva. Antes del DROP se validaron
  ID, host distinto de producción, base de datos, TLS y creación reciente.
- Diez tablas de aplicación requeridas y relaciones sin huérfanos correctas.
  Comparación adicional local: conteos y huellas de filas coinciden en las once
  tablas public/drizzle con el snapshot del dump, incluida la de migraciones.
  El workflow actual verifica invariantes/conteos; no promete esta comparación
  adicional de huellas en cada ejecución programada.
- Manifiesto remoto actualizado a `restore.status=verified`.
- Ejecución sin forzar: no corresponde otro respaldo dentro de ocho días.
- Ramas de ensayo eliminadas. Consulta final: solo main y staging originales;
  staging sigue archivada. Dumps y manifiestos locales temporales retirados;
  la identidad age se pasó por stdin, sin crear un archivo privado de identidad.

## Alcance y limitaciones

Esto prueba que la copia puede recuperarse, no que el scheduler ya esté operativo.
No se hizo push, PR, merge remoto ni despliegue Vercel. Las correcciones siguen
locales. La copia anterior publicada en main usa herramientas 17/contexto inválido
del runner; debe corregirse antes de ejecutar Actions.

No se restauró producción, no se migró su esquema y no se cambió staging. No se
incluyen imágenes Cloudinary ni cambios que aún solo existan en IndexedDB.
Los logs/documentos no contienen contraseñas, tokens, fotografías ni filas reales.

Los primeros intentos del harness local se detuvieron por una opción faltante de
pg_restore; se corrigió el harness y se repitió satisfactoriamente. No fue una
restauración sobre producción ni una prueba aprobada ocultando errores. Una
limpieza temporal necesitó repetirse tras completar la operación de Neon; la
consulta final verificó que no quedaron ramas de ensayo.

## Evidencia pendiente

1. Publicación autorizada por develop y lanzamiento revisado a main.
2. Run manual Actions restaurando la copia existente, con limpieza correcta.
3. Ejecución programada real y notificaciones de fallo; mecanismo para detectar
   un scheduler ausente o una copia atrasada.
4. Continuidad OAuth Drive en 4B. El éxito de hoy no elimina el vencimiento de
   Testing ni convierte un refresh token en permanente.

Consulta read-only de GitHub: [run publicado fallido](https://github.com/JosueMM01/my-closet/actions/runs/37224352106)
con anotación `Unrecognized named-value: runner` al validar job.env. No se lanzó
otro job ni se volvió a ejecutar el workflow inválido.

El informe local detallado sin secretos quedó fuera de Git en una carpeta
temporal del equipo; este documento conserva la evidencia esencial versionable.
