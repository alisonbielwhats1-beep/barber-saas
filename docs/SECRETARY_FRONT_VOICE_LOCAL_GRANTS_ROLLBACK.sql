-- Local disposable only: 127.0.0.1:55441/everflair_service_mvp.
-- Baseline from 2026-09-25T13-02-48-049Z. NOT a migration or production SQL.
-- Table-level REVOKE also removes existing per-column SELECTs; restore them explicitly.
-- Only run with the guarded target/backup verification in the recovery script.
BEGIN;
REVOKE SELECT ON "Product", "ClientProfile" FROM mvp_service_runtime;
REVOKE SELECT (id) ON "Payment" FROM mvp_service_runtime;
GRANT SELECT ("active", "id", "minStock", "name", "salonId", "stock", "updatedAt") ON "Product" TO mvp_service_runtime;
GRANT SELECT ("authIdentityId", "email", "id", "mergedIntoId", "name", "passwordHash", "phone", "phoneNormalized", "salonId", "userId", "xmin") ON "ClientProfile" TO mvp_service_runtime;
COMMIT;
