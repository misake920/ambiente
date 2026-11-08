# Biblioteca de lives interativas

A biblioteca oferece seis cenários WebGL originais, renderizados com Three.js: Dark Bot, Foguete da comunidade, Batalha neon, Torre do Pix, Jardim da comunidade e Órbita dos presentes. Os modelos são configurações, não atividade simulada. Uma conta nova continua com zero eventos, pagamentos e sessões.

## Começar uma sessão

1. Abra **Biblioteca de lives** e visualize um modelo. Os botões de comando e de Pix nessa janela executam apenas uma simulação local, sem gravar eventos.
2. Personalize uma cópia se necessário. É possível editar nome, descrição, cenário, cores, orientação, meta de pontos, comandos, intervalo por pessoa e até oito faixas de Pix. Cada workspace pode guardar até 100 modelos personalizados.
3. Selecione **Usar modelo e abrir estúdio**. Isso cria uma sessão com uma cópia da configuração, zera o progresso e seleciona a cena Principal. Editar ou remover o modelo da biblioteca não modifica uma sessão já aberta. Encerre a sessão atual antes de iniciar outra.
4. Conecte LivePix em **Contas**. O chat pode vir de uma conta YouTube autorizada ou da entrada para conector externo da Central de lives.
5. Use **Usar no TikTok / OBS** para copiar a URL privada de saída. O formato vertical é 1080 × 1920; o horizontal é 1920 × 1080. A cena OBS exportada usa essas dimensões.
6. No OBS, adicione uma fonte de navegador com essa URL. Vincule a plataforma pelo recurso disponibilizado para sua conta e inicie a transmissão. No TikTok LIVE Studio, use fonte de navegador quando disponível ou capture a janela de saída.

Abrir uma sessão do estúdio não inicia uma transmissão na plataforma. A conta precisa ter o acesso de transmissão oferecido pelo TikTok. A renderização 3D exige WebGL/aceleração de hardware. Em dispositivos sem esse suporte, a interface explica a indisponibilidade; não exibe uma imagem estática como se o modelo estivesse executando.

## Regras e progresso

Uma doação real dispara somente a maior faixa cujo valor mínimo foi atingido. As configurações iniciais aceitam qualquer Pix positivo, desde R$ 0,01; R$ 5 e R$ 20 acionam as faixas seguintes. Valores e intensidades podem ser alterados em uma cópia. A Batalha neon permite selecionar a equipe com `!roxo` ou `!verde` na mensagem do Pix.

Comandos correspondem à primeira palavra da mensagem, sem diferenciar maiúsculas e minúsculas. O intervalo do modelo se aplica por pessoa; os filtros gerais de moderação, aprovação manual, pausa e emergência continuam válidos. Pagamentos pendentes, mensagens bloqueadas e notificações financeiras não verificadas não acionam o cenário.

As ações entram na fila existente com prioridade 50 e duração de três segundos. A configuração de regras anterior permanece disponível. O progresso só é atualizado dentro da transação que concede a execução a um único consumidor. Outra janela não pode reaplicar a mesma ação. Encerrar a sessão cancela suas ações pendentes e em execução. Eventos explicitamente marcados como teste animam temporariamente o cenário, mas não alteram o progresso real nem a receita. Os pontos e objetos do modelo não são valores financeiros.

Os cenários limitam a quantidade de geometria visível para manter a renderização leve; os contadores preservam os totais executados da sessão. Cenas da galeria são estáticas; a prévia e a saída usam animação, respeitando a preferência por redução de movimento. Modelos podem ser exportados e importados em JSON (até 64 KB na interface), sempre validados pelo servidor. A importação permite configurar os seis cenários existentes; não executa HTML, scripts ou arquivos 3D externos.

## Entrada de chat externo

O TikTok Login Kit não autoriza o chat LIVE. A ponte criada nesta versão recebe mensagens de um **conector externo autorizado e compatível com webhooks**; ela não busca mensagens diretamente do TikTok/Kwai e não comprova aprovação de nenhum serviço terceiro.

Na Central de lives, abra **Conectar chat**, crie a entrada e copie URL e chave. A chave é mostrada uma vez e guardada no servidor somente como hash. Configure o conector para enviar um POST HTTPS de servidor para servidor:

```http
POST /api/chat-bridges/ID/events
Authorization: Bearer CHAVE_DO_CONECTOR
Content-Type: application/json
```

```json
{
  "externalId": "identificador-unico-da-mensagem",
  "user": "Nome do participante",
  "message": "!pular",
  "isTest": false
}
```

O comando deve existir no modelo em execução. O ID deve ser único por mensagem; repetidos são deduplicados. `isTest: true` permite conferir o caminho sem alterar totais reais. Há limite de 120 requisições por minuto e IP, validação de campos e moderação antes de gerar ações. O indicador só registra recebimento depois de uma chamada autenticada. A entrada aceita somente chat: campos como `kind`, `amount` e eventos financeiros são recusados. Pix continuam verificados pela API LivePix.

Gerar nova chave revoga a anterior. Excluir a entrada bloqueia futuras mensagens. Cada workspace pode manter até 20 entradas para contas/conectores diferentes. A receita não usa os valores enviados por esta ponte.

## Validação

Testes automatizados cobrem os seis modelos, faixas de Pix, isolamento entre workspaces, edição/importação validada, execução exclusiva, progresso, testes sem receita, aprovação, moderação, intervalo por pessoa, encerramento de sessão, autenticação e revogação dos conectores externos. Os testes de navegador verificam renderização 3D, prévia local, personalização, persistência, saída vertical e execução no overlay. As respostas das plataformas são controladas nos testes; a conexão de um canal real e de um conector externo continua dependendo das autorizações do proprietário.
