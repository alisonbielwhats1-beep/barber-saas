# Evidência temporal por papel

O Golden v8 preservou valores semânticos corretos em GF12 e GF20, mas o transporte antigo permitia uma lista com o mesmo rótulo repetido para trechos diferentes. O guard conservador rejeitou essa evidência inconsistente. Os outputs originais continuam preservados em `src/test/fixtures/secretary-real-wire-golden8-temporal.json`.

O mapa de seis chaves foi a primeira correção, mas o Golden v9 mostrou sua limitação: GF12 forneceu `weekday=3` e `source_weekday=2` corretamente, enquanto `temporal_evidence.date` e `source_date` ficaram null. O backend rejeitou as datas sem prova e voltou a perguntar informação já fornecida. O output e a projeção observada estão preservados, com hashes, em `src/test/fixtures/secretary-real-wire-golden9-temporal.json`.

O SDK agora publica cada seletor temporal como `null` ou `{value,literal}` no próprio campo. Exemplo: `weekday:{value:3,literal:"quarta"}`. Os dez seletores são date/day_offset/weekday/time, source_date/source_day_offset/source_weekday/source_time e end_date/end_time. `literal` deve conter 1–600 caracteres e não pode ser só espaço. Valor presente sem literal, valor nulo dentro do objeto e metadados adicionais são inválidos. NEW, ADD, PATCH, RESUME, CURRENT e V1 publicam a mesma forma, sem o mapa independente `temporal_evidence`.

O decoder somente desembrulha `value` e mapeia estaticamente o nome do seletor para o papel interno. Não lê português, não redistribui citações, não preenche valores ausentes e não modifica argumentos brutos. Dois seletores no mesmo papel são rejeitados, inclusive se aparentemente redundantes: o modelo deve escolher um. Os mapas e arrays históricos permanecem no caminho privado de compatibilidade e continuam sujeitos aos guards originais, incluindo rejeição de evidências duplicadas e contradições.

`period` permanece o enum semântico existente da Luna. Manhã/tarde/noite sem relógio não gera evidência de data ou hora, nem pendência artificial de horário. Este patch não adiciona um segundo classificador de períodos; a reconciliação factual entre horário exato e período continua ativa.

O transporte de estoque usa o mesmo princípio, em contrato próprio: `quantity:{value,literal}`. A composição dos dois decoders é somente estrutural; validação factual de medida e unidade pertence ao domínio de estoque.

Validação offline do contrato acoplado: **204/204 testes, nove arquivos**. O SDK real com fetch simulado exercitou 1/2/5/10 ações, todas as rotas e guards de domingo/sábado, origem/destino, negação, qualificadores, timezone e conflito de seletores. Os oito payloads mistos com dez ações ativas e cinquenta suspensas ficaram abaixo do limite conservador 64.000; maior observado 62.478, incluindo reserva de protocolo 8.192. Dez ações de agenda com três conflitos de calendário por ação e cinquenta suspensas com metadados chegaram a 61.550. O guard e todo o contexto foram preservados. Nenhuma chamada real, banco ou holdout foi usado.

Os contrafactuais de GF12/GF20 fornecem explicitamente pares completos para testar o adapter; não comprovam que Luna emitirá esses valores e literais numa nova bateria. Os outputs reais v8/v9 continuam falhando como originalmente e não são reparados silenciosamente. GF11 é outra classe: ambiguidade residual de período, preservada em estado ativo separado. Resposta curta como "da tarde" ainda exige o candidato, papel e contexto vigente para ser aceita.

Backup anterior ao acoplamento: `.demo/temporal-value-literal-before/manifest.json`. A primeira implementação do mapa continua documentada historicamente em `.demo/temporal-evidence-map-freeze.json`.
