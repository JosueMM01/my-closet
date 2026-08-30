\set ON_ERROR_STOP on

DO $$
DECLARE
  required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'account_invitations',
    'auth_accounts',
    'calendar_entries',
    'garments',
    'images',
    'outfits',
    'password_reset_tokens',
    'sessions',
    'users',
    'wardrobe_shares'
  ]
  LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'Falta la tabla requerida: %', required_table;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM garments child
    LEFT JOIN users parent ON parent.id = child.user_id
    WHERE parent.id IS NULL
  ) THEN RAISE EXCEPTION 'Hay prendas sin usuario'; END IF;

  IF EXISTS (
    SELECT 1 FROM outfits child
    LEFT JOIN users parent ON parent.id = child.user_id
    WHERE parent.id IS NULL
  ) THEN RAISE EXCEPTION 'Hay conjuntos sin usuario'; END IF;

  IF EXISTS (
    SELECT 1 FROM calendar_entries child
    LEFT JOIN users parent ON parent.id = child.user_id
    WHERE parent.id IS NULL
  ) THEN RAISE EXCEPTION 'Hay entradas de calendario sin usuario'; END IF;

  IF EXISTS (
    SELECT 1 FROM images child
    LEFT JOIN users parent ON parent.id = child.user_id
    WHERE parent.id IS NULL
  ) THEN RAISE EXCEPTION 'Hay imágenes sin usuario'; END IF;

  IF EXISTS (
    SELECT 1 FROM wardrobe_shares child
    LEFT JOIN users parent ON parent.id = child.grantor_id
    WHERE parent.id IS NULL
  ) THEN RAISE EXCEPTION 'Hay invitaciones de armario sin propietario'; END IF;
END $$;

SELECT current_setting('server_version') AS restored_server_version;
SELECT
  (SELECT count(*) FROM users) AS users,
  (SELECT count(*) FROM garments) AS garments,
  (SELECT count(*) FROM outfits) AS outfits,
  (SELECT count(*) FROM calendar_entries) AS calendar_entries,
  (SELECT count(*) FROM images) AS images;
