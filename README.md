# 00 do Dark

Estúdio web em português para operar interações, overlays OBS, contas e publicações. O rascunho 0.2 usa uma interface compacta em preto com roxo discreto, login obrigatório e painéis baseados na atividade da conta.

## Rodar localmente

Requisitos: Node.js 24+, npm, Chromium para os testes de navegador e `ffprobe`/`ffmpeg` para validar arquivos e gerar o vídeo de teste.

```bash
npm ci
npm run dev
```

Abra `http://localhost:5173` e crie uma conta. O backend usa a porta 3001. O cadastro cria somente preferências e duas regras editáveis; não cria contas sociais, pagamentos, mensagens, publicações ou transmissões fictícias. Sessões antigas de demonstração voltam à tela de acesso. Em produção, `DEMO_ENABLED=false` desativa o endpoint de demonstração.

## Operar uma live

1. Em **Contas**, configure seu aplicativo YouTube e autorize o canal. Ative a leitura do chat no gerenciamento da conta. A live precisa estar ativa e acessível por esse canal.
2. Para doações, use **Conectar LivePix** com as credenciais da sua aplicação. O servidor verifica o perfil e as permissões de leitura antes de marcar a integração como conectada.
3. Em **Interações**, ajuste gatilhos, comandos, valores, prioridade, moderação e cooldown. Os testes são identificados e não entram nas métricas reais.
4. Em **Central de lives → Configurar OBS**, copie o link privado para uma Fonte de navegador em 1920 × 1080. É possível baixar um JSON de coleção de cenas para importar no OBS.
5. Configure câmera, microfone e destino no OBS e inicie a transmissão por ele. A câmera/tela aberta dentro do site é uma prévia local; não envia vídeo à plataforma.

O overlay é transparente quando não há conteúdo. Personagem, meta e ranking são opcionais, inicialmente ocultos. Configure-os em **Configurações**. A voz usa a síntese do navegador/OBS e depende das vozes instaladas e da liberação de áudio. Uma falha de voz aparece como falha de execução; não é marcada como sucesso.

A indicação **Overlay ativo** confirma que o link está recebendo atualizações. Ela não comprova que o OBS iniciou uma transmissão. O painel reproduz somente testes explícitos quando o overlay está desconectado; eventos reais pertencem ao consumidor do overlay, evitando que o painel roube a execução.

## Recursos implementados

- Cadastro, login, sessões HttpOnly, senha derivada por scrypt, 2FA TOTP e equipes com permissões. Recuperação de senha depende de SMTP.
- PostgreSQL/Supabase em produção e SQLite local. Dados isolados por workspace, auditoria, transações e leases entre instâncias.
- Regras de doação/chat/seguidores; fila persistente, aprovação, pausa, cancelamento, emergência e confirmação exclusiva por consumidor.
- Filtros de links, palavras, tamanho e frequência, incluindo mensagens pagas. Receita confirmada é preservada quando uma mensagem é bloqueada.
- Cenas de overlay, quiz com votos únicos, alertas, som, fala, animações, imagens próprias e link privado revogável.
- Prévia local de câmera/microfone e compartilhamento de tela com tratamento de permissões e encerramento dos dispositivos.
- Biblioteca privada de vídeos e imagens com validação real por ffprobe. Calendário semanal/mensal/lista, fusos IANA, rascunhos, capas, hashtags, textos por destino e confirmação manual identificada.
- Relatórios e CSV. Testes ficam fora da receita e dos indicadores reais; o painel exibe até 500 eventos recentes.

## Integrações

| Plataforma | Disponível no rascunho | Dependências e limites |
| --- | --- | --- |
| YouTube | OAuth por workspace, renovação/revogação, canais, upload resumível, capa e leitura de chat ativo | Aplicativo Google, escopos e autorização do canal. Ainda sem teste ponta a ponta com credenciais reais. Envio padrão privado. |
| LivePix | Credenciais cifradas por workspace; consultas autenticadas de pagamentos/mensagens, deduplicação, moderação e webhook que dispara nova consulta | Aplicação LivePix com permissões de leitura. Webhooks são opcionais. Contrato oficial conferido e testes com respostas controladas; validação com conta real permanece pendente. Estornos não implementados. |
| TikTok | Login Kit de identidade, cadastro manual e planejamento | Login Kit não autoriza LIVE/chat/transmissão. Publicação direta e integração LIVE não implementadas. |
| Kwai | Contas manuais e planejamento | Envio assistido, sem publicação automática ou chat. |
| OBS | Overlay transparente, link revogável e exportação de cena | O envio RTMP acontece no OBS. Não há controle remoto do OBS nem retransmissão de vídeo pelo servidor. |

As credenciais OAuth podem ser salvas pelo proprietário em **Contas → Configurar aplicativo**, cifradas e isoladas por workspace. Variáveis de servidor continuam disponíveis como padrão. Segredos não são retornados pela API de estado. Consulte [docs/integrations.md](docs/integrations.md).

## Persistência e publicação

A configuração existente usa Vercel Hobby e o projeto Supabase **00 do dark**, com PostgreSQL, mídia privada e agendador a cada minuto. O domínio configurado é `https://00-do-dark.vercel.app`. A presença do código neste rascunho não significa que ele já foi publicado nesse domínio.

O orçamento de mídia é 900 MiB; vídeos até 50 MiB e imagens até 10 MiB. Painel e overlay consultam atualizações a cada 4 e 2,5 segundos. O intervalo mínimo de sincronização das integrações é 10 segundos, respeitando intervalos maiores informados pela plataforma.

Veja [docs/deployment.md](docs/deployment.md). A publicação deve ser executada somente quando autorizada. O script não cria serviços pagos nem redefine a senha principal do banco.

Para uso local com SQLite, preserve o diretório `var/` e `ENCRYPTION_KEY`; `npm run backup` faz backup consistente. Para PostgreSQL, use as ferramentas do provedor ou `pg_dump` e inclua os objetos privados na recuperação. A restauração completa ainda não foi validada.

## Validação

```bash
npm run build
npm test
# Com npm run dev em execução:
npm run test:e2e
```

Os testes de navegador cadastram contas locais, usam um vídeo de um segundo e dispositivos de captura de teste do Chromium. Verificam login sem atividade inventada, persistência, upload, agendamento manual, execução exclusiva no overlay, transparência e navegação mobile. Não transmitem para redes sociais nem criam pagamentos reais.

Os testes do conector LivePix usam respostas controladas para verificar permissões, deduplicação, taxas cobertas pelo apoiador, moedas, pagamentos históricos, moderação e proteção dos segredos. Não substituem um teste autorizado com a conta real.

Ainda faltam transmissão direta do servidor, conectores LIVE TikTok/Kwai, publicação automática nessas plataformas, estornos LivePix, TTS de servidor e sincronização labial. O sistema não garante ausência de restrições e não contorna verificações das plataformas.
