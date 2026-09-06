-- Somente leitura. Não imprime dados de clientes nem credenciais.
DO $$ DECLARE actual_type text; item record; BEGIN
  IF to_regclass('public."Appointment"') IS NULL OR to_regclass('public."Professional"') IS NULL OR to_regprocedure('app_current_salon()') IS NULL THEN
    RAISE EXCEPTION 'Pré-requisitos ausentes: Appointment, Professional ou app_current_salon';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('Appointment', 'checkedInAt', 'timestamp with time zone'), ('Appointment', 'checkedInById', 'text'),
    ('ProfessionalOpening', 'id', 'text'), ('ProfessionalOpening', 'salonId', 'text'), ('ProfessionalOpening', 'professionalId', 'text'),
    ('ProfessionalOpening', 'dateKey', 'character varying'), ('ProfessionalOpening', 'startMinutes', 'integer'),
    ('ProfessionalOpening', 'endMinutes', 'integer'), ('ProfessionalOpening', 'reason', 'text'), ('ProfessionalOpening', 'createdAt', 'timestamp with time zone')
  ) AS expected(tbl, col, typ) LOOP
    SELECT data_type INTO actual_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = item.tbl AND column_name = item.col;
    IF actual_type IS NOT NULL AND actual_type <> item.typ THEN RAISE EXCEPTION 'Tipo incompatível %.%', item.tbl, item.col; END IF;
    IF item.tbl = 'ProfessionalOpening' AND to_regclass('public."ProfessionalOpening"') IS NOT NULL AND actual_type IS NULL THEN RAISE EXCEPTION 'Tabela de aberturas incompleta: %', item.col; END IF;
  END LOOP;
END $$;
