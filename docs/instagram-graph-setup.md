# Configurar o Instagram na Auditoria de Perfil (API oficial da Meta)

Este guia mostra, passo a passo, como ligar a **API oficial do Instagram
(Graph API — Business Discovery)** para a funcionalidade **Auditoria de
Perfil** do CRM. Com isso, ao clicar em **"Analisar perfil"** num contato, o
Instagram passa a trazer dados oficiais e estruturados (seguidores, bio, posts
recentes com curtidas/comentários) em vez do scraping, que é limitado e
instável.

> **É opcional.** Sem essa configuração, a auditoria continua funcionando com o
> scraping (Scrapling). Ao configurar, o Instagram usa a API oficial e só cai
> no scraping quando a conta é pessoal ou a API falha.

**Tempo estimado:** 15–30 min. **Custo:** gratuito.

---

## O que você vai obter no final

Dois valores para colocar no arquivo `.env.local`:

| Variável | O que é |
| --- | --- |
| `META_GRAPH_TOKEN` | Token de acesso de longa duração, com permissões de leitura |
| `META_IG_USER_ID` | Id da **sua** conta do Instagram Business (a da agência) |

---

## Pré-requisitos (confira antes de começar)

- [ ] Você tem uma conta do **Instagram** que seja **Profissional** (tipo
      **Empresa** ou **Criador de conteúdo**) — não serve conta pessoal.
- [ ] Essa conta do Instagram está **vinculada a uma Página do Facebook**.
- [ ] Você tem acesso ao **Meta for Developers** (developers.facebook.com) e a um
      **app** já criado (você tem: `1950559809124223`).

> ⚠️ **Importante sobre o que a API lê:** o Business Discovery só consegue ler
> perfis de **contas Business/Creator públicas**. Perfis pessoais não são
> acessíveis por nenhuma API — para esses, o CRM cai automaticamente no
> scraping.

### Como vincular o Instagram a uma Página (se ainda não fez)

1. No app do Instagram: **Configurações → Conta → Mudar para conta
   profissional** (escolha **Empresa** ou **Criador**).
2. Ainda no Instagram: **Configurações → Central de Contas** (ou **Página do
   Facebook conectada**) → conecte a uma Página do Facebook que você administra.
3. Se não tiver uma Página, crie uma grátis em facebook.com/pages/create.

---

## Passo 1 — Adicionar o produto Instagram ao app

1. Acesse **developers.facebook.com** → **Meus Apps** → selecione o app
   `1950559809124223`.
2. No menu lateral, em **Adicionar produto**, procure **Instagram** (ou
   **Instagram Graph API**) e clique em **Configurar**.
3. Não precisa preencher mais nada aqui agora — só deixar o produto adicionado.

---

## Passo 2 — Gerar o token no Explorador da Graph API

Esse é o jeito mais fácil e **não exige terminal**. O token fica na sessão do
navegador; você não precisa copiá-lo para lugar nenhum ainda.

1. Abra o **Explorador da Graph API**:
   **developers.facebook.com/tools/explorer**
2. No canto **direito**:
   - Em **App Meta**, selecione o app `1950559809124223`.
   - Em **Token de Acesso do Usuário**, clique para adicionar as **permissões**
     abaixo (campo "Adicionar permissões" / "Permissions"):
     - `instagram_basic`
     - `instagram_manage_insights`
     - `pages_read_engagement`
     - `pages_show_list`
   - Clique em **Gerar token de acesso** e autorize na janela que abrir.

Agora o Explorador já está autenticado. **Não copie o token ainda** — use o
próprio Explorador para os próximos passos.

---

## Passo 3 — Descobrir o `META_IG_USER_ID`

Ainda no Explorador da Graph API:

1. Na barra de requisição (ao lado do botão **Enviar**), apague o que estiver
   escrito, digite **`me/accounts`** e clique em **Enviar**.
2. A resposta é um JSON parecido com:
   ```json
   {
     "data": [
       { "name": "Nome da sua Página", "id": "1234567890", "access_token": "..." }
     ]
   }
   ```
   Copie o número do campo **`"id"`** da sua Página (ex.: `1234567890`).
   > Se vier `{"data": []}` (vazio), a conta do Instagram ainda não está
   > vinculada a uma Página — volte à seção de pré-requisitos.
3. Agora troque a barra de requisição por (colando o id no lugar de
   `ID_DA_PAGINA`):
   ```
   ID_DA_PAGINA?fields=instagram_business_account
   ```
   e clique em **Enviar**.
4. A resposta será:
   ```json
   {
     "instagram_business_account": { "id": "17841400000000000" },
     "id": "1234567890"
   }
   ```
   O número em **`instagram_business_account.id`** (ex.: `17841400000000000`) é
   o seu **`META_IG_USER_ID`**. Anote.

---

## Passo 4 — Gerar um token de **longa duração**

O token do Passo 2 é curto (expira em ~1–2 horas). Troque por um de longa
duração (~60 dias). No Explorador, ao lado do token, clique no ícone de
informação (ⓘ) e depois em **"Abrir na ferramenta de tokens de acesso"** — lá
existe o botão **"Estender token de acesso"**.

Ou, se preferir, faça a troca por chamada (precisa do **App Secret**, que fica
em **Configurações → Básico** do app):

```
https://graph.facebook.com/v22.0/oauth/access_token?grant_type=fb_exchange_token&client_id=1950559809124223&client_secret=SEU_APP_SECRET&fb_exchange_token=SEU_TOKEN_CURTO
```

A resposta traz um `access_token` novo — **esse** é o de longa duração, o que
vai no `META_GRAPH_TOKEN`.

> 💡 Para um token que **não expira**, gere um **token de Página** de longa
> duração: com o token de usuário de longa duração já em mãos, rode
> `me/accounts` de novo — o `access_token` que aparece em cada página é um token
> de página que não expira enquanto suas permissões continuarem válidas.

---

## Passo 5 — Preencher o `.env.local`

Abra o arquivo `.env.local` na raiz do projeto e acrescente (ou preencha) estas
linhas:

```env
META_GRAPH_TOKEN=<cole aqui o token de longa duração do Passo 4>
META_IG_USER_ID=<cole aqui o id do Passo 3>
META_GRAPH_API_VERSION=v22.0
```

Salve o arquivo e **reinicie o servidor** (`npm run dev`) para ele ler as novas
variáveis.

---

## Passo 6 — Testar

1. Garanta que o servidor foi reiniciado depois de editar o `.env.local`.
2. Abra um contato que tenha, no campo **Instagram**, o `@usuario` de uma conta
   **Business/Creator** conhecida (pode ser o da sua própria agência).
3. Clique em **"Analisar perfil"**.
4. Em 1–3 minutos, a anotação deve aparecer. Na seção **"Perfis analisados"**, a
   linha do Instagram deve mostrar **"(via API oficial)"** e as **"Melhorias
   sugeridas"** ficam mais concretas (baseadas em seguidores, posts recentes,
   etc.).

Se aparecer **sem** o "(via API oficial)", o CRM caiu no scraping — veja a
solução de problemas abaixo.

---

## Segurança

- **Nunca** faça commit do `.env.local` nem cole o token em conversas,
  e-mails ou prints. O token dá acesso de leitura à sua conta.
- Se um token vazar, invalide-o: gere um novo no Explorador e, para forçar a
  invalidação de tokens antigos, **redefina o App Secret** em
  **Configurações → Básico**.
- O `.env.local` já é ignorado pelo Git neste projeto.

---

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| A nota não mostra "(via API oficial)" | Sem token, token inválido, ou conta pessoal | Confira `META_GRAPH_TOKEN`/`META_IG_USER_ID` no `.env.local` e se reiniciou o servidor. Se a conta-alvo for pessoal, é esperado cair no scraping. |
| `me/accounts` volta `{"data": []}` | Instagram não vinculado a uma Página | Vincule a conta a uma Página (pré-requisitos). |
| Erro com `code: 190` | Token expirado/inválido | Gere um token novo (Passos 2 e 4). |
| Erro com `code: 100` | Username não existe ou não é Business/Creator | Confirme o `@usuario`; contas pessoais não são lidas pela API. |
| Erro com `code: 4/17/32/613` | Limite de requisições atingido (~200/h) | Aguarde e tente de novo mais tarde. |

### Acesso em produção (contas de terceiros em escala)

Para consultar contas fora dos seus **testadores** de forma ampla, o app precisa
estar em modo **Ao vivo** e ter **Acesso Avançado** nas permissões
`instagram_basic`, `instagram_manage_insights` e `pages_read_engagement` — o que
exige **Revisão do App (App Review)** e **verificação de negócio**. Para uso
inicial e testes com os seus próprios ativos, o **Acesso Padrão** já funciona.

---

## Referência técnica (o que o CRM faz por baixo)

O CRM chama, do lado do servidor (arquivo
[`src/lib/leads/instagram-graph.ts`](../src/lib/leads/instagram-graph.ts)):

```
GET https://graph.facebook.com/{versao}/{META_IG_USER_ID}
    ?fields=business_discovery.username({handle}){
       username,name,biography,website,
       followers_count,follows_count,media_count,
       media.limit(12){caption,like_count,comments_count,timestamp,media_type,permalink}
    }
    &access_token={META_GRAPH_TOKEN}
```

O `{handle}` é extraído automaticamente do campo Instagram do contato. Falhas
(sem token, conta pessoal, rate limit) fazem o CRM **cair no scraping** sem
interromper a auditoria.
