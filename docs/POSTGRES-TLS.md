# Transporte PostgreSQL do Core

Executado em 2026-08-30, horário de São Paulo (2026-08-31 UTC), com autorização de manutenção do banco compartilhado.

## Resultado verificado

- Serviço `systembots/evolution-api-db`, imagem preservada `pgvector/pgvector:pg17`, porta pública 9000.
- SSL ativado por `ALTER SYSTEM` e `pg_reload_conf()`. Sem reinício do PostgreSQL ou redeploy de aplicativos.
- Core: TLS 1.3; certificado, validade e hostname verificados; `/health`: `database=connected`, `database_transport=tls-verified`.
- `DATABASE_SSL=require` e URL com `sslmode=verify-full&sslrootcert=certs/postgres-server.crt`. O caminho relativo pressupõe iniciar na raiz deste repositório.
- Senha de `tzolkin_core_app` rotacionada pelo canal verificado; senha antiga testada e rejeitada (`28P01`). Nenhuma outra role foi rotacionada.
- Regras `hostnossl all tzolkin_core_app` com `reject` para IPv4 e IPv6 precedem regras antigas. Teste remoto sem senha real confirmou rejeição (`28000`) antes de autenticar.
- Core local reiniciado. Nenhum dado de cliente foi criado para testes. Testes unitários: 28/28.
- PostgreSQL confirmou início em 2026-08-28: a manutenção não reiniciou a instância. Evolution API, bot_gabi e designer apresentaram contêineres `running`, com dois dias de atividade.
- `hf` e `notebooklm_connector` estavam desabilitados na conferência final. `skiller` constava habilitado, mas sem contêiner em execução e sem erro retornado pelo painel. Causa e estado anterior não foram estabelecidos; não foi iniciado nem alterado nesta manutenção. Essa pendência impede afirmar que todos os aplicativos estão saudáveis.

## Certificado e confiança

Certificado próprio **autossinado**, confiado explicitamente só pelo cliente do Core — não é certificado de uma CA pública. A confiança inicial foi estabelecida comparando o SHA-256 com o console administrativo HTTPS autenticado, antes de qualquer autenticação no PostgreSQL.

- Certificado público versionado: `certs/postgres-server.crt`.
- SHA-256: `A1:39:7C:95:45:7F:09:69:10:2F:E4:45:87:B1:AF:D4:7B:F6:B2:14:F0:0F:60:47:F6:07:6D:72:A5:FD:CA:7A`.
- SAN: `DNS:easypanel.landcriativa.com`; RSA 3072, SHA-256, finalidade `serverAuth`.
- Validade até **2027-08-31 02:09:49 UTC**. Renovar com antecedência; não há renovação automática.
- Chave privada permanece somente no servidor, em `/var/lib/postgresql/data/tls-core-20260831/server.key`, owner postgres, modo 0600; diretório modo 0700.
- `ssl_cert_file` e `ssl_key_file` persistem em `postgresql.auto.conf`, dentro do volume de dados.

Para renovação, emitir novo certificado/chave em diretório separado; obter fingerprint pelo console autenticado; adicionar o novo certificado ao trust bundle do Core antes da troca; atualizar os caminhos no PostgreSQL e recarregar; reiniciar o Core e validar uma nova conexão. Só então remover a confiança antiga. Nunca contornar falhas com `rejectUnauthorized:false`, `allow` ou `sslmode=no-verify` na aplicação. Uma CA administrada e renovação automatizada são recomendadas antes de ampliar para produção.

`scripts/inspect-db-certificate.mjs` inspeciona **somente** o certificado público, sem enviar autenticação PostgreSQL; exige fingerprint externo e verifica hostname/validade. Não usar a conexão de inspeção para consultas.

## Backup e reversão

Antes da alteração: `pg_dumpall` completo, 166 MB, incluindo bases e roles, e cópias de `postgresql.conf`, `postgresql.auto.conf` e `pg_hba.conf`, em diretório `tls-backup-20260831-*` dentro do volume `/var/lib/postgresql/data`. Diretório criado por `mktemp`, modo 0700, arquivos protegidos por umask 077. Backup concluído com código de sucesso e checksum; **restauração ainda não ensaiada**. Esta cópia local não substitui backup externo.

Não restaurar `cluster.sql` para reverter apenas TLS: isso sobrescreveria dados desnecessariamente. Para problema de certificado, manter o Core parado, preservar TLS e recuperar os arquivos corretos ou emitir novo certificado. Restaurar as configurações antigas desabilita TLS e exige autorização consciente do risco; o Core deve continuar recusando plaintext. Validar `pg_hba_file_rules` e recarregar antes de qualquer retomada.

Arquivos `.env.before-tls-*` e `.env.before-rotation-*` foram preservados localmente, ignorados pelo Git. Contêm outros segredos ainda válidos: não compartilhar. A senha antiga do Core foi invalidada; não restaurar esses arquivos cegamente. Em restauração integral do dump, rotacionar novamente a role do Core, pois o dump contém o hash anterior.

## Limites e pendências

- TLS obrigatório no servidor foi limitado à role do Core. Outros consumidores ainda precisam de migração e validação próprias; habilitar TLS no servidor não os migra automaticamente.
- Porta 9000 continua publicada; firewall/allowlist ou rede privada permanecem pendentes. Redis não foi alterado.
- Em 2026-09-03, 16 backups PostgreSQL estão agendados no EasyPanel, incluindo `tzolkin_core`;
  continuam em disco local, sem retenção explícita e sem ensaio de restauração em ambiente isolado.
- Formulários do institucional permanecem desabilitados. Core continua bootstrap local, não pronto para publicação.

Referências: [PostgreSQL 17 — TLS](https://www.postgresql.org/docs/17/ssl-tcp.html), [EasyPanel — PostgreSQL](https://easypanel.io/docs/services/postgres).
