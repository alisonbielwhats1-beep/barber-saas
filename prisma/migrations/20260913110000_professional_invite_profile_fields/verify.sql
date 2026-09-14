-- Somente leitura. As duas colunas devem existir, ser anuláveis e do tipo text.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'UserInvite'
  AND column_name IN ('pendingPhone', 'pendingAvatarUrl')
ORDER BY column_name;
