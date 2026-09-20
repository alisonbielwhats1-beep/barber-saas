# Recuperação da implantação

Antes da ativação, manter AUTH_PROVIDER ausente e promover o deployment anterior.
A migration é aditiva: não remover AuthIdentity, vínculos, perfis ou históricos.

Depois de qualquer senha alterada no Supabase, NÃO voltar à validação bcrypt:
isso reativaria uma senha anterior. Corrigir por roll-forward, mantendo Supabase
como autoridade. O deployment de recuperação precisa entender AuthIdentity.
Se necessário, suspender novos cadastros/recuperação, preservando o login Auth.
Backup criptografado das tabelas afetadas é obrigatório antes da importação.
Não restaurar em bloco sobre alterações posteriores de clientes.
