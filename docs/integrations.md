# Contratos e limites das integrações

## YouTube

Recursos conferidos no documento oficial de descoberta Google (consulta de 08/11/2026): `channels.list`, `videos.insert` com upload resumível, `liveBroadcasts.list`, `videos.list` (`statistics`, `liveStreamingDetails`), `liveChatMessages.list`; escopos `youtube.readonly` e `youtube.upload`. O login usa OAuth authorization code com PKCE, state de uso único vinculado ao usuário/workspace e consentimento offline. Tokens são armazenados cifrados, sem exposição na API do frontend.

Para operar:
1. Criar um projeto Google Cloud e habilitar YouTube Data API v3.
2. Configurar consentimento, audiência e usuários de teste ou obter aprovação para produção.
3. Criar credenciais OAuth para aplicação web; cadastrar a origem e o retorno exatos.
4. Salvar Client ID/Secret em Contas → Configurar aplicativo. Também é possível usar as variáveis de `.env.example` como padrão do servidor.
5. Autorizar uma conta fora da demonstração. Conferir permissões reais e testar com um vídeo privado antes de oferecer publicação pública.

O conector **não foi exercitado com credenciais reais** nesta entrega. A descoberta oficial confirma recursos, mas não comprova aprovação, cotas ou capacidade de publicar para uma conta específica. Projetos não auditados podem ter uploads limitados a privado. Tokens OAuth não comprovam permissão de transmissão.

Uploads obtêm sessão resumível antes de enviar bytes. Erros transitórios antes da sessão podem ser reagendados com espera exponencial, no máximo três tentativas. Após criar a sessão, um resultado incerto exige revisão manual em vez de repetir o envio. Reinícios não reapresentam uploads incertos como concluídos. O painel só marca conclusão automática com ID retornado pelo YouTube. A visibilidade padrão é privada.

O chat só é lido de transmissões ativas acessíveis pela conta autorizada. O conector respeita o intervalo mínimo informado pela API, com piso de 10 segundos, e aguarda 60 segundos ao não encontrar live ou encontrar falha. Não há envio automático de mensagens ao chat.

A Visão geral soma `statistics.viewCount` e `statistics.likeCount` das transmissões ativas das contas YouTube autorizadas, deduplicando o ID do vídeo. Visualizações representam reproduções acumuladas da live, não espectadores simultâneos. As métricas são consultadas mesmo com a leitura de chat desligada. A descoberta de transmissões é renovada a cada minuto; estatísticas, no mínimo a cada 30 segundos. Dados ausentes ou com mais de três minutos sem atualização não viram zero. A interface identifica falta de conexão, indisponibilidade e somas parciais.

“Presentes enviados” contabiliza os eventos capturados pelo chat da live ativa: `membershipGiftingEvent` (quantidade de assinaturas compradas), `superStickerEvent` (um sticker) e `giftEvent` (quantidade `comboCount` informada pela API). Avisos `giftMembershipReceivedEvent` dos destinatários são ignorados para não duplicar a compra. A deduplicação usa o ID da mensagem. O indicador representa os presentes observados pela integração, não uma reconciliação de todo o histórico anterior à conexão. Não converte presentes, joias, Super Chats ou moedas em receita BRL. A contagem depende de leitura de chat autorizada e disponível.

O gráfico neon fica visível mesmo sem pagamentos, com uma linha em zero e legenda explícita. A série de 24 horas é agregada no banco, sem a limitação dos 500 eventos do feed, e exclui testes, pagamentos pendentes e eventos de outros workspaces. “Valor recebido” usa exatamente o mesmo total de doações confirmadas. A API inclui a série e a disponibilidade de cada métrica em `/api/state`.


## LivePix

Contrato conferido em `https://api.livepix.gg/open-api.json` e `https://docs.livepix.gg/api/`.

O fluxo de pagamentos usa Client Credentials com `account:read`, `payments:read` e `messages:read`. O escopo `webhooks` é opcional: se a solicitação ampla for recusada por escopos, o conector tenta as permissões mínimas de leitura. Antes de gravar uma conexão ativa, consulta `/v2/account`, `/v2/payments` e `/v2/messages` com o token fornecido pela plataforma. Client Secret e tokens ficam cifrados no workspace e não são devolvidos ao frontend.

As consultas paginadas de pagamentos recebidos geram eventos reais em BRL. O ID financeiro, combinado ao ID da conta, impede repetição de doações e ações. Mensagens são associadas pelo comprovante/referência e passam pela moderação local; sinalizações da plataforma também bloqueiam a leitura. Quando o apoiador cobre a tarifa, o valor de contribuição exclui essa tarifa, conforme os campos `coverFees`/`fee` do contrato. As demais moedas não são convertidas implicitamente em reais.

Pagamentos anteriores à primeira conexão não disparam ações. Cada consulta examina no máximo cinco páginas de cem itens por endpoint. O conector não oferece reconciliação ilimitada de histórico nem tratamento de estornos. A receita apresentada representa as contribuições recebidas processadas pela integração, não o saldo líquido da carteira.

Quando autorizado, o sistema registra um webhook de URL aleatória e guarda somente o hash do segredo. O conteúdo do POST externo é ignorado: uma notificação apenas solicita nova consulta à API autenticada. Nenhum payload do navegador ou webhook define o valor confirmado de uma doação. Há deduplicação, limite de requisições e lease de sincronização.

A sincronização pode ocorrer pelo painel, overlay e agendador, com intervalo mínimo de dez segundos. Ao falhar a autorização, a interface informa a necessidade de reconectar; erros não são apresentados como pagamentos recebidos.

O OAuth de identidade existente continua separado e, isoladamente, não habilita pagamentos. O conector financeiro foi validado com respostas controladas e ainda precisa de um teste ponta a ponta autorizado com uma conta LivePix real. Não há credenciais LivePix da conta do usuário configuradas nesta entrega.

## TikTok e Kwai

O TikTok Login Kit pode gerar um link oficial de autorização (e QR para abrir esse link), quando `TIKTOK_CLIENT_KEY` e `TIKTOK_CLIENT_SECRET` estiverem configurados. A conta deve aprovar o acesso. Esse fluxo vincula a identidade; não autoriza transmissão, chat ou interações do TikTok LIVE. Um link público de perfil/live também pode ser salvo para o fluxo assistido, sem ser apresentado como autorização.

Para Kwai, o portal público inspecionado correspondeu a Marketing API. Não foi verificado um fluxo genérico que autorize LIVE/chat/transmissão. As contas continuam assistidas. Nenhuma senha ou cookie da plataforma é solicitado.

O sistema não transmite vídeo por RTMP nem substitui o OBS. Integrações de LIVE exigem produtos oficiais ou acesso de parceiro e elegibilidade da conta. A existência de um link de login não demonstra essas permissões.

## Rede

Foram salvos no rascunho do ambiente os domínios: `docs.livepix.gg`, `developers.google.com`, `developers.tiktok.com`, `developers.kwai.com`, `api.livepix.gg`, `oauth.livepix.gg`, `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`. Os endpoints LivePix de leitura e autenticação foram conferidos no contrato oficial. Os testes locais não fazem chamadas com credenciais reais.

Os acessos de gerenciamento do Supabase e Vercel foram validados por HTTPS, com credenciais protegidas do ambiente. Nenhuma credencial OAuth das plataformas foi configurada. Os scripts usam `NODE_USE_ENV_PROXY=1` para herdar o proxy e preservar a verificação TLS.
