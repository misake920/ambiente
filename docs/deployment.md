# Publicação gratuita: Vercel + Supabase

O projeto usa a Vercel Hobby para a interface e API Node 24. O banco PostgreSQL e o bucket privado de mídia ficam no projeto Supabase existente **00 do dark**, na região us-east-1. Nenhum servidor Render ou recurso pago é contratado pelos scripts.

A aplicação fica em https://00-do-dark.vercel.app. O script de publicação só libera a interface com gravação depois de verificar a API, o agendador e o armazenamento.

## Conectar e publicar

Nos segredos do ambiente de desenvolvimento, configure `VERCEL_TOKEN` para `api.vercel.com` e `SUPABASE_ACCESS_TOKEN` para `api.supabase.com`. Nunca coloque valores no chat, no Git ou em variáveis `VITE_*`.

Com o projeto Vercel vinculado em `.vercel/project.json`:

```bash
npm ci
npm test
npm run deploy:supabase
```

O script seleciona o projeto Supabase existente pelo nome, verifica o plano Hobby da Vercel e cria a role `dark_app` e o schema privado `dark`. A senha principal do banco não é alterada. As credenciais da aplicação são gravadas como variáveis sensíveis da Vercel, somente no ambiente de produção. O token pessoal de gerenciamento do Supabase permanece no ambiente de desenvolvimento.

O cache privado de provisionamento fica fora da raiz da aplicação, em `../.cache/00-do-dark-deployment`, com diretório 0700 e arquivos 0600. Preserve esse diretório de forma segura enquanto a configuração for mantida. `ENCRYPTION_KEY` existente não é substituída; perdê-la impede recuperar tokens OAuth e segredos TOTP. Os arquivos `.vercel/` são ignorados pelo Git.

O pacote publicado contém JavaScript compilado, dependências e a interface. Não contém banco, arquivos enviados, chaves, cache de provisionamento ou dados de um workspace real.

## Persistência e agendamento

- PostgreSQL via pooler de transações com TLS verificado. Transações serializáveis e leases coordenam consumidores e envios entre instâncias da API.
- Mídia no bucket privado `00-do-dark-media`. O navegador envia diretamente por URL assinada; o servidor confere tamanho, formato, duração e dimensões antes de aceitar o arquivo.
- Limite de 50 MiB por vídeo e 10 MiB por imagem. O orçamento interno de armazenamento é 900 MiB; reservas pendentes também contam.
- `pg_cron` + `pg_net` chamam `/api/internal/tick` a cada minuto, usando um segredo do schema privado. O navegador não precisa permanecer aberto para processar publicações. A chamada só é aceita com `CRON_SECRET` e há um lease para impedir execuções concorrentes.
- A interface consulta atualizações a cada 3 segundos; o overlay, a cada 2,5 segundos. O chat do YouTube é consultado pelo agendador, respeitando o intervalo remoto.
- Limpeza periódica de sessões, links expirados, reservas de upload, demonstrações antigas e histórico além da retenção configurada.

A precisão do agendamento é de aproximadamente um minuto e depende da disponibilidade dos serviços. O plano gratuito do Supabase pode pausar projetos por inatividade e tem cotas de banco, armazenamento e tráfego. O script não muda planos, não fornece garantia de disponibilidade contínua e não implementa transmissão RTMP.

## Variáveis da API

`POSTGRES_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `ENCRYPTION_KEY`, `CRON_SECRET`, `APP_ORIGIN`, `DATA_DIR=/tmp/00-do-dark` e `DARK_SERVERLESS=1`.

O disco `/tmp` serve apenas a processamento temporário. Se a configuração persistente estiver incompleta, a API responde 503; não utiliza SQLite temporário como fallback de produção.

A conexão usa o certificado raiz vinculado pelo painel oficial do Supabase em `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`, com validação TLS e de hostname. `POSTGRES_CA` permite fornecer o certificado explicitamente.

O endpoint `/api/health` confirma `databaseDriver=postgresql` e `cloudSetup=true`. `/api/internal/setup` e `/api/internal/tick` exigem autenticação interna; não retornam segredos.

Credenciais OAuth de YouTube, TikTok e LivePix e SMTP são configurações independentes. Vincular o Supabase não autoriza contas sociais, pagamentos ou transmissão. Confira [integrations.md](integrations.md).

## Alternativa local

O Dockerfile e o Compose continuam disponíveis para uma única instância com SQLite e disco persistente. `npm run backup` é exclusivo dessa modalidade. Para PostgreSQL use `pg_dump` ou as ferramentas do provedor, preservando a chave de criptografia e os objetos do bucket. A restauração completa deve ser validada antes de uso comercial.
