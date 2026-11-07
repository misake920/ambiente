# Publicação: Vercel e servidor persistente

O projeto usa uma interface estática na Vercel e uma API Node 24 com SQLite,
arquivos enviados e fila contínua. A API precisa de **uma instância sempre ativa
com volume persistente**. Functions da Vercel com SQLite temporário não atendem
esses requisitos. Nenhum serviço pago foi contratado automaticamente.

## Estado desta entrega

- Projeto Vercel `00-do-dark` criado na conta conectada; domínio previsto
  `https://00-do-dark.vercel.app`. **Prévia visual publicada e sinalizada.**
- A prévia permite navegar com dados simulados; alterações, login, pagamentos
  e publicações ficam bloqueados. A aplicação com backend ainda não foi publicada.
- Build e contêiner de produção testados localmente.
- Cadastro, sessão, regra e vídeo preservados depois de reiniciar o contêiner.
- Falta uma hospedagem da API com disco persistente e URL HTTPS pública.
- Credenciais e aprovações das plataformas também são necessárias para as
  integrações reais; veja [integrations.md](integrations.md).

## 1. Hospedar a API

### Render preparado

O arquivo [`render.yaml`](../render.yaml) define a proposta: Docker, região Ohio,
plano **Starter**, uma instância e disco de **1 GB** em `/data`. O Starter e o
disco são pagos. O preço vigente deve ser conferido no
[Render](https://render.com/pricing) antes da criação; não há contratação apenas
por salvar o arquivo ou conectar a conta.

Para permitir a implantação pelo agente, crie uma chave na sua conta Render e
adicione **RENDER_API_KEY** aos segredos das configurações deste ambiente,
com destino **api.render.com**. Nunca envie a chave pelo chat. O rascunho já
inclui esse requisito e os domínios do Render. Revise, salve e publique a
configuração do ambiente para ativar a conexão; salvar o rascunho sozinho não
aplica as credenciais.

```bash
# Consulta a conta e salva .render/proposal.json, sem contratar recursos.
npm run render:prepare
# Após revisar plano e custo: cria o serviço, aguarda a API e publica a interface.
npm run deploy:render
```

Se houver vários workspaces Render, defina `RENDER_OWNER_ID` para escolher o
destino. O script não altera serviços com o mesmo nome que não foram vinculados
por ele, não recria um serviço salvo e não apaga discos. O identificador é salvo
em `.render/service.json`, ignorado pelo Git. A conta Render precisa ter acesso
ao repositório GitHub; para repositório privado, conecte a integração GitHub do
Render e conceda acesso apenas ao repositório necessário.

Também é possível revisar a configuração no fluxo
[Deploy to Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fmisake920%2Fambiente),
depois que o código estiver publicado no GitHub. Esse fluxo exige login no
Render e confirmação do plano pelo titular.

Os formatos da API foram conferidos no código do
[cliente oficial Render](https://github.com/render-oss/cli/tree/main/pkg/client).
O provisionamento remoto ainda depende da conexão da conta e não foi validado.

### Configuração do contêiner

Use o `Dockerfile` em um serviço de contêiner com disco persistente ou em um VPS.
Não use serviços que suspendam o processo: a fila precisa continuar executando.

| Configuração | Valor |
| --- | --- |
| Versão Node | 24 ou superior |
| Porta interna | `3001` |
| Volume persistente | Montado em `/data`, gravável pelo usuário `node` (UID 1000) |
| Réplicas | `1` |
| Health check | `/api/health` |
| `APP_ORIGIN` | `https://00-do-dark.vercel.app` |
| `DATA_DIR` | `/data` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` somente atrás de um proxy confiável que controla os cabeçalhos |

O volume inclui banco, vídeos, capas e chave de criptografia. Preserve a chave
nos backups. A chave é gerada na primeira inicialização; não a copie para o Git.
Configure OAuth e SMTP por variáveis protegidas do provedor, quando disponíveis.

Para VPS, o `compose.yaml` mantém os dados em `dark-data` e expõe o serviço
somente em `127.0.0.1:3001`. Um proxy reverso com TLS deve publicar essa porta.
Exemplo de inicialização no servidor escolhido:

```bash
APP_ORIGIN=https://00-do-dark.vercel.app TRUST_PROXY=1 docker compose up -d --build
```

Esse comando pressupõe o proxy confiável já configurado. Não remova o volume
durante atualizações. Não execute `docker compose down --volumes` em produção.

Use HTTPS no endereço público da API. O proxy deve aceitar o tamanho de vídeos
definido no produto (até 512 MB), permitir respostas SSE e não armazenar respostas
autenticadas em cache. Os limites de upload e duração do caminho completo,
incluindo o proxy externo da Vercel, ainda precisam de verificação no host real.

## 2. Publicar a interface

### Prévia visual

Uma prévia estática pode ser publicada enquanto o backend é conectado:

```bash
npm run build:preview
npm run test:preview
npm run deploy:preview
```

Ela usa `dist-preview/`, exporta somente uma demonstração recém-criada e exibe
um aviso permanente. Não usa o banco existente, não autentica pessoas, não envia
requisições à API e bloqueia alterações. Não recebe pagamentos nem publica
vídeos. O teste inclui navegação pelas cinco telas, mobile e bloqueio de ações.
Este deploy usa o domínio do projeto e será substituído pela aplicação quando
o backend estiver disponível. `npm run build` continua gerando a aplicação
normal em `dist/`, com a API real obrigatória.

### Aplicação com backend

Com o backend hospedado e respondendo, configure `BACKEND_URL` no ambiente de
execução do deploy. É a origem pública, como `https://api.seu-dominio.com`, sem
caminho, usuário, senha ou parâmetros. `VERCEL_TOKEN` é uma credencial protegida
do ambiente conectado; não coloque tokens em arquivos versionados.

```bash
npm ci
npm run build
BACKEND_URL=https://api.seu-dominio.com npm run deploy:vercel
```

O script usa a API REST oficial da Vercel, verifica a saúde da API e seu
`APP_ORIGIN`, prepara as regras de proxy e envia **apenas `dist/`**. Banco, mídia,
chaves e `.env` não são enviados. As requisições `/api/*` seguem para o backend e
têm cache compartilhado desabilitado. O navegador usa o mesmo domínio da
interface, inclusive para autenticação, OAuth e SSE.

A vinculação local está em `.vercel/project.json` (ignorada pelo Git). Em outro
ambiente, vincule o projeto `00-do-dark` na conta Vercel antes de executar o
script. O deploy só é confirmado após `READY` e verificação de `/api/health` pelo
domínio público. Se o host da API mudar, é necessário novo deploy da interface.

## 3. Verificar no domínio final

Verifique cadastro/login/logout, upload e reprodução, atualização de regra,
calendário com o fuso escolhido, eventos SSE e fonte OBS. Reinicie o backend e
confirme a persistência. Configure o callback OAuth como
`https://00-do-dark.vercel.app/api/connect/youtube/callback` e teste com uma conta
real aprovada antes de depender de publicações automáticas.

LivePix real e conectores automáticos TikTok/Kwai ainda não estão implementados.
Os dados do modo demonstração são identificados como simulados. Os testes locais
não comprovam uma integração com as plataformas nem o funcionamento de um deploy
que ainda não existe.

## Comparação visual

Com `npm run dev` aberto e Chromium instalado:

```bash
npm run visual:capture -- final
node scripts/visual-report.mjs
```

Com o servidor de desenvolvimento aberto, acesse
`http://localhost:5173/artifacts/visual/comparison.html`. O relatório permite comparar referência,
primeiro print e versão atual nas cinco telas, com sobreposição e controle de
opacidade. Prints feitos a 1586 × 992. Não atribuímos porcentagem de identidade:
ilustrações refeitas, fonte aproximada e dados dinâmicos ainda produzem diferenças.
