-- PREFLIGHT SOMENTE LEITURA — não é migration e não corrige dados.
--
-- Deve retornar zero anomalias antes da migration 012. O preflight não usa
-- as colunas novas de propósito: ele pode ser executado contra o schema
-- produtivo anterior, antes de qualquer ALTER TABLE.

SELECT
  COUNT(*)::bigint AS cross_tenant_appointment_products
FROM "AppointmentProduct" ap
JOIN "Appointment" a ON a.id = ap."appointmentId"
JOIN "Product" p ON p.id = ap."productId"
WHERE a."salonId" <> p."salonId";

SELECT
  COUNT(*)::bigint AS orphan_appointment_products
FROM "AppointmentProduct" ap
LEFT JOIN "Appointment" a ON a.id = ap."appointmentId"
LEFT JOIN "Product" p ON p.id = ap."productId"
WHERE a.id IS NULL OR p.id IS NULL;

SELECT
  COUNT(*)::bigint AS payments_without_salon
FROM "Payment" payment
LEFT JOIN "Appointment" a ON a.id = payment."appointmentId"
LEFT JOIN "Salon" salon ON salon.id = a."salonId"
WHERE salon.id IS NULL;

SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'AppointmentProduct' AND column_name IN ('salonId', 'productName', 'currency')
      AND data_type NOT IN ('text', 'character varying'))
    OR (table_name = 'Payment' AND column_name = 'currency'
      AND data_type NOT IN ('text', 'character varying'))
  );

SELECT 1 AS missing_app_current_salon_function
WHERE to_regprocedure('app_current_salon()') IS NULL;
