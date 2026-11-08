# Contratos e limites das integrações

## YouTube

Recursos conferidos no documento oficial de descoberta Google (consulta de 07/11/2026): `channels.list`, `videos.insert` com upload resumível, `liveBroadcasts.list`, `liveChatMessages.list`; escopos `youtube.readonly` e `youtube.upload`. O login usa OAuth authorization code com PKCE, state de uso único vinculado ao usuário/workspace e consentimento offline. Tokens são armazenados cifrados, sem exposição na API do frontend.

Para operar:
1. Criar um projeto Google Cloud e habilitar YouTube Data API v3.
2. Configurar consentimento, audiência e usuários de teste ou obter aprovação para produção.
3. Criar credenciais OAuth para aplicação web; cadastrar a origem e o retorno exatos.
4. Injetar os nomes definidos em `.env.example`, sem compartilhar valores em chat.
5. Autorizar uma conta fora da demonstração. Conferir permissões reais e testar com um vídeo privado antes de oferecer publicação pública.

O conector **não foi exercitado com credenciais reais** nesta entrega. A descoberta oficial confirma recursos, mas não comprova aprovação, cotas ou capacidade de publicar para uma conta específica. Projetos não auditados podem ter uploads limitados a privado. Tokens OAuth não comprovam permissão de transmissão.

Uploads obtêm sessão resumível antes de enviar bytes. Erros transitórios antes da sessão podem ser reagendados com espera exponencial, no máximo três tentativas. Após criar a sessão, um resultado incerto exige revisão manual em vez de repetir o envio. Reinícios não reapresentam uploads incertos como concluídos. O painel só marca conclusão automática com ID retornado pelo YouTube. A visibilidade padrão é privada.

O chat só é lido de transmissões ativas acessíveis pela conta autorizada. O conector respeita o intervalo mínimo informado pela API, com piso de 10 segundos, e aguarda 60 segundos ao não encontrar live ou encontrar falha. Não há envio automático de mensagens ao chat.

## LivePix

A documentação oficial foi acessada após a atualização da política de rede. O fluxo de autorização de identidade por link foi implementado, com state de uso único, retorno vinculado ao usuário e armazenamento cifrado dos tokens. É necessário configurar `LIVEPIX_CLIENT_ID` e `LIVEPIX_CLIENT_SECRET` e registrar a URL de retorno.

A autorização identifica a conta; o adaptador de pagamentos ainda não foi implementado nem validado com uma conta real.

O motor interno aceita eventos somente por código de integração confiável; a rota pública de teste sempre força `isTest=true`. Não existe rota externa de pagamento que aceite um valor arbitrário e o trate como doação real.

Pendências para implementar o conector: conferir documentação oficial vigente; identificar fluxo de autorização; listar status de pagamento; verificar eventos por assinatura ou consulta autenticada, conforme contrato oficial; impedir replay; reconciliar eventos perdidos; lidar com estornos/reembolsos; testar em ambiente apropriado. Somente então habilitar recebimento real na interface.

## TikTok e Kwai

O TikTok Login Kit pode gerar um link oficial de autorização (e QR para abrir esse link), quando `TIKTOK_CLIENT_KEY` e `TIKTOK_CLIENT_SECRET` estiverem configurados. A conta deve aprovar o acesso. Esse fluxo vincula a identidade; não autoriza transmissão, chat ou interações do TikTok LIVE. Um link público de perfil/live também pode ser salvo para o fluxo assistido, sem ser apresentado como autorização.

Para Kwai, o portal público inspecionado correspondeu a Marketing API. Não foi verificado um fluxo genérico que autorize LIVE/chat/transmissão. As contas continuam assistidas. Nenhuma senha ou cookie da plataforma é solicitado.

O sistema não transmite vídeo por RTMP nem substitui o OBS. Integrações de LIVE exigem produtos oficiais ou acesso de parceiro e elegibilidade da conta. A existência de um link de login não demonstra essas permissões.

## Rede

Foram salvos no rascunho do ambiente os domínios: `docs.livepix.gg`, `developers.google.com`, `developers.tiktok.com`, `developers.kwai.com`, `api.livepix.gg`, `oauth.livepix.gg`, `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`. Os destinos LivePix de operação são requisitos a confirmar no contrato oficial; nenhuma chamada de produção foi feita.

Os acessos de gerenciamento do Supabase e Vercel foram validados por HTTPS, com credenciais protegidas do ambiente. Nenhuma credencial OAuth das plataformas foi configurada. Os scripts usam `NODE_USE_ENV_PROXY=1` para herdar o proxy e preservar a verificação TLS.
