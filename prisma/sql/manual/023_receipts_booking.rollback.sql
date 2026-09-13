-- Recuperação sem apagar dados: manter schema 023 e usar correção compatível (roll forward).
-- Não voltar ao código que deduplica serviços depois da primeira repetição gravada.
-- Antes da primeira escrita nova, restauração integral do backup validado em banco novo
-- é alternativa mediante janela/autorizações. Nunca apagar pagamentos/ofertas para reverter.
SELECT status,count(*) FROM "WaitlistOffer" GROUP BY status;
SELECT "appointmentId","serviceId",count(*) FROM "AppointmentService" GROUP BY 1,2 HAVING count(*)>1;
SELECT count(*) AS adjusted_payments FROM "Payment" WHERE "extraServices"<>'[]'::jsonb OR "surchargeCents">0 OR "paidAt"<>"recordedAt";
