-- Non-destructive rollback: revert the application and keep the column.
-- With the previous code deployed the column is ignored and every cover shows
-- the salon name again; dropping it would discard the owners' choices.
BEGIN TRANSACTION READ ONLY;
SELECT count(*) FILTER (WHERE NOT "coverShowName") AS salons_hiding_name FROM public."Salon";
COMMIT;
