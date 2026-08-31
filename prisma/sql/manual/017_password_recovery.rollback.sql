-- Rollback deliberadamente não destrutivo da recuperação de senha.
--
-- O rollback funcional consiste em promover o commit anterior da aplicação.
-- As colunas abaixo permanecem inertes e compatíveis com a versão anterior.
-- Removê-las apagaria tokens e versões de sessão e não faz parte do rollback.

DO $$
BEGIN
  IF to_regclass('public."User"') IS NULL
    OR to_regclass('public."ClientProfile"') IS NULL THEN
    RAISE EXCEPTION 'Tabelas obrigatórias de autenticação ausentes';
  END IF;
END $$;
