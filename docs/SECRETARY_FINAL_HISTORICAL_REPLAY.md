# Replay histórico da estabilização final

Execução offline em 26/09/2026. **16/16 PASS:** 15 entradas históricas e uma verificação de proveniência. Nenhuma rede, inferência, confirmação ou mutation de negócio.

Os testes usam os mesmos dados e asserções no BEFORE/AFTER local. O primeiro replay obteve 13/16: os três outputs de continuação Amanda, originalmente preenchidos no papel errado, faziam o guard retirar também o destino aceito. O guard agora rejeita o patch que responde outro papel e preserva o valor independente anteriormente aceito. O campo realmente solicitado continua pendente. Correções factualmente contraditórias continuam sendo retiradas.

- **Amanda 1:** argumentos brutos originais, obtidos do journal e comparados à auditoria, passam pelo SDK e grounding atuais. Origem 11h, destino 09h e data 27/09 sobrevivem sem rejeição.
- **Amanda 2–4:** os três argumentos brutos semanticamente errados são reproduzidos sem edição. O estado de entrada é explicitamente contrafactual: destino 09h preservado e `source_time` pendente. O guard impede alterar destino para 11h e o contexto informa o papel aguardado. Isso prova contenção local do output errado, não prova o que uma nova inferência dirá.
- **G:** a fonte é a resposta real do backend mais o diagnóstico `weekday=6`, não uma resposta bruta completa da Luna. O sábado 03/10 capturado é rejeitado para o transcript de domingo; o horário 10h continua. Não foi feita consulta de disponibilidade ou execução.
- **H41/H42/H44/H46/H49:** dez planos/turnos reais passam pela apresentação e contexto atuais. Conferidos plano imutável, dados e dependências preservados, contagens 1/2/5/10, perguntas sem duplicação e ausência de nomes técnicos. A fixture existente é confrontada com o arquivo original cujo hash consta na auditoria. Esses dados foram capturados depois do adapter; não são apresentados como provider bruto.

Os quatro cenários adicionais da revisão independente também passaram: preço/consulta de serviço enquanto entidade está pendente, consulta após seleção, retomada de proposta expirada sem confirmação disponível e leitura dependente com data absoluta preservada.

[Artefato de resultados, hashes e limites](./SECRETARY_FINAL_HISTORICAL_REPLAY.json). Os arquivos originais não foram editados. Os relatórios completos BEFORE/AFTER e o runner reproduzível estão identificados por caminho e SHA-256 no artefato.

```powershell
$env:HISTORY_REPLAY_PHASE='revalidation'
npx.cmd vitest run --config .demo/historical-pipeline-replay.config.mts --reporter=dot
```

Limites: não mede entidade real, disponibilidade real, RLS de banco, conversa livre nova nem generalização de Luna. Não usa Golden Free Use ou holdout. Esses gates pertencem às demais camadas de validação e não são substituídos por este replay.
