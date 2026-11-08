# 00 do Dark

Estúdio web em português para preparar lives interativas, automações, overlays OBS e um calendário de conteúdo. Interface preta e roxa neon inspirada nas cinco referências aprovadas, com um mascote original.

Esta é uma **versão inicial funcional**, não uma entrega de todas as integrações descritas no briefing. O fluxo local tem backend, banco, filas e testes reais. Pagamentos e conexões externas não são simulados como integrações de produção.

## Rodar

Requisitos: Node.js 24+, npm e `ffprobe` (pacote ffmpeg). O ffmpeg também é usado para gerar o vídeo de teste dos testes de navegador.

```bash
npm ci --cache /workspace/.npm-cache
npm run dev
```

O Vite usa a porta 5173 e encaminha `/api` ao Node na porta 3001. Na primeira visita é criado um workspace de demonstração privado por sessão. O selo **Demonstração** fica visível. Nenhuma conta externa é autorizada nem vídeo é enviado nesse modo. Para usar dados próprios, abra o perfil e escolha **Entrar ou criar conta**.

A demonstração começa com a fila pausada. Em **Interações**, selecione uma regra e clique em **Testar interação**. O teste libera a fila. Para começar vazio, crie sua própria conta.

## O que funciona

- Sete telas responsivas: visão geral, lives, editor de interações, publicações, contas, relatórios e configurações.
- Cadastro/login, senha derivada por scrypt, sessões HttpOnly, 2FA TOTP e convites com funções de proprietário/operador/moderador. Recuperação de senha depende do SMTP.
- PostgreSQL no Supabase em produção; SQLite WAL no desenvolvimento local. Migrações, isolamento por workspace, auditoria e leases distribuídos.
- Editor de regras por evento, valor, comando, prioridade, cooldown, duração e acumulação. Duplicar, editar, salvar, desfazer e excluir regras.
- Fila persistente, aprovação, pausa, cancelamento e confirmação por consumidor. Apenas um consumidor assume uma ação. Ações sem confirmação expiram; não são repetidas automaticamente.
- Moderação antes de qualquer ação, inclusive para doações: palavras, links, caracteres e intervalo de mensagens. Uma mensagem bloqueada não é lida. A receita confirmada continua contabilizada independentemente da moderação.
- Biblioteca de estilos de personagem e upload de arte PNG/JPEG/WebP privada, cores e posição de alertas, contagem regressiva e ranking opcional no overlay.
- Simulador separado das métricas reais, cenas de prévia, parada de emergência, quiz com comandos `!1`, `!2`, `!3`, votos únicos e pontuação no servidor.
- Overlay para Fonte de navegador do OBS, link privado revogável, cenas, alertas, animação e fala usando a síntese do navegador. O som precisa ser ativado e depende de vozes pt-BR disponíveis no navegador/OBS. O mascote é uma ilustração animada, sem sincronização labial avançada.
- Biblioteca de vídeos com validação por ffprobe, armazenamento privado, reprodução autenticada e exclusão.
- Calendário e lista, rascunhos, modelos de descrição/hashtags, capas personalizadas, textos por conta de destino, fusos IANA, duplicação, reagendamento, cancelamento e status independente por destino.
- Publicações assistidas geram pendências; sua confirmação manual exige um link e é identificada como manual. Não aparece como resposta de API.
- Relatórios a partir dos eventos persistidos, filtro e CSV; dados de testes não somam à receita real. O painel mostra até 500 eventos recentes; o CSV inclui o histórico retido.

## Integrações externas

| Plataforma | Implementado | Dependência / limite |
| --- | --- | --- |
| YouTube | OAuth com PKCE/state, identificação de canais, renovação/revogação, upload resumível, envio de capa e leitura do chat de uma live ativa | Código implementado, mas **sem validação ponta a ponta com conta real**: faltam Client ID/Secret, consentimento e aprovação Google. Uploads seguem cotas e regras da conta/aplicativo. |
| LivePix | Autorização oficial da identidade por link; simulador separado de eventos e regras | Recebimento real de pagamentos, reconciliação e estornos ainda não implementados. Autorizar identidade não comprova recebimento de doações. |
| TikTok | Login Kit por link/QR quando configurado, contas assistidas e calendário | Login Kit vincula identidade. Não concede acesso ao TikTok LIVE, chat ou transmissão. Publicação e LIVE exigem produtos e aprovações específicos. |
| Kwai | Contas assistidas, calendário e confirmação manual | Publicação automática e chat não implementados. Acesso e documentação de parceiro precisam ser confirmados. |
| OBS | Fonte de navegador para overlay | Não há transporte RTMP, controle remoto de cenas do OBS nem transmissão simultânea. A transmissão é iniciada no OBS/plataforma. |

A fonte oficial utilizada para conferir os recursos YouTube foi o documento de descoberta mantido em [googleapis/google-api-go-client](https://github.com/googleapis/google-api-go-client/blob/main/youtube/v3/youtube-api.json). As páginas de documentação completas ainda dependem da liberação de rede. Veja [docs/integrations.md](docs/integrations.md).

## Configuração

Copie `.env.example` para `.env` se precisar alterar os padrões. Nunca versione `.env`. `APP_ORIGIN` deve ser a origem exata usada no navegador. Em desenvolvimento, localhost/127.0.0.1 nas portas 5173 e 3001 também são aceitos. Produção aceita somente `APP_ORIGIN` e exige HTTPS para os cookies.

Para OAuth YouTube, configure `YOUTUBE_CLIENT_ID` e `YOUTUBE_CLIENT_SECRET` no servidor e cadastre o retorno `APP_ORIGIN/api/connect/youtube/callback` no Google Cloud. Use a opção **Autorizar pelo Google** em uma conta própria, fora da demonstração. Nenhuma senha de rede social é solicitada.

O SMTP usa `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` e, quando necessário, `SMTP_USER`/`SMTP_PASSWORD`. Sem SMTP, o sistema informa que recuperação não está configurada; nenhum e-mail é fingido.

## Produção e dados

Para Vercel com API persistente, consulte [docs/deployment.md](docs/deployment.md).
A publicação usa Vercel Hobby e o projeto Supabase existente, com PostgreSQL, bucket privado e agendamento por `pg_cron`. Nenhum recurso pago é criado. O domínio é [00-do-dark.vercel.app](https://00-do-dark.vercel.app).

O comparador visual fica em `artifacts/visual/comparison.html`; os prints finais
das cinco telas ficam em `artifacts/visual/final/`.

```bash
npm run build
# Configure APP_ORIGIN=https://seu-dominio e persistência antes de iniciar.
npm start
```

O Express serve `dist` e `/api` na porta 3001. Use proxy reverso TLS. Ative `TRUST_PROXY=1` somente com um proxy confiável e porta do Node não exposta diretamente. Configure também os cabeçalhos e limites de upload do proxy (até 512 MB). Mantenha o processo com systemd/serviço equivalente.

Na Vercel, os dados ficam no PostgreSQL e Supabase Storage; `/tmp` é usado apenas durante a validação e o envio de arquivos. Vídeos têm limite de 50 MiB e imagens de 10 MiB, com orçamento de armazenamento de 900 MiB. O agendador executa aproximadamente a cada minuto; painel e overlay usam consultas periódicas. Veja os limites e a configuração em [docs/deployment.md](docs/deployment.md).

A alternativa local usa uma única instância com SQLite e disco persistente. `npm run backup` faz backup consistente do SQLite. No PostgreSQL, use as ferramentas do provedor ou `pg_dump` e inclua a mídia privada no plano de recuperação. Preserve `ENCRYPTION_KEY` de forma segura: sem ela, tokens OAuth e segredos TOTP não podem ser recuperados. A restauração completa em outro host ainda não foi validada.

A limpeza periódica remove demonstrações após 24 horas, sessões/links expirados, uploads pendentes e histórico além da retenção. A exclusão integral de conta e o monitoramento operacional devem ser ampliados antes de operação comercial.

## Validação

```bash
npm run build
npm test
# Com npm run dev em execução e Chromium instalado:
npm run test:e2e
```

Os testes de navegador geram seu próprio vídeo de um segundo em uma pasta temporária usando ffmpeg. Não enviam conteúdo às plataformas. Os testes cobrem navegação desktop/mobile, persistência de regras, execução de teste, calendário e upload/reprodução real de um vídeo local.

Os testes de servidor verificam autenticação, isolamento entre usuários, roles, TOTP, deduplicação, confirmação de pagamentos no motor interno, moderação, cooldown, justiça da fila, confirmação exclusiva, persistência em outro processo, emergência, revogação do overlay, agendamento, fusos, upload inválido e confirmação manual sem falso sucesso remoto.

## Fora desta versão

Faltam: adaptador LivePix real e estornos, conectores automáticos TikTok/Kwai, personagens com rigging 3D/expressões avançadas, TTS de servidor, sincronização labial, geração/recorte de vídeos, IA, notificações externas, monitoramento operacional completo, métricas de espectadores e receita obtidas diretamente das plataformas. Não são apresentados como recursos concluídos.

Nenhum sistema garante ausência de banimento. O projeto não resolve CAPTCHAs nem contorna verificações, limites ou punições. Verificações devem ser concluídas pelo titular nos fluxos oficiais.
