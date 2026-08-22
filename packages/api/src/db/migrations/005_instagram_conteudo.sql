-- Rastro — conteúdo vindo da API oficial do Instagram (22/08/2026).
--
-- Duas coisas novas, e uma decisão de produto por trás delas.
--
-- O dono pediu duas funcionalidades que dependem de guardar conteúdo no
-- servidor: ver comentários recebidos (que o export não traz) e ler mensagens
-- diretas sem marcar como vistas no Instagram. Levantei o custo — até aqui
-- nenhum texto de conversa saía do aparelho — e a decisão foi seguir.
--
-- O que torna isso defensável está na coluna `payload_enc` das duas tabelas:
-- **o servidor grava sem poder ler**. O aparelho manda uma chave pública, o
-- webhook cifra com ela, e a privada nunca sai do celular. Ver lib/cofre.ts.
--
-- Por isso, e sem exceção:
--
--   1. Nenhuma coluna em claro guarda texto escrito por uma pessoa. Nem trecho,
--      nem prévia, nem "só para busca". Metadado (quando, qual conversa, se foi
--      o usuário que mandou) fica em claro porque a listagem ordena e pagina por
--      ele; conteúdo, nunca.
--   2. Nada aqui vai para /admin. O painel do dono mostra contagem de erro, não
--      conversa de usuário.
--   3. Retenção é curta e automática. Ver `expires_at`.

-- ---------------------------------------------------------------------------
-- A chave pública do aparelho
-- ---------------------------------------------------------------------------

/*
 * Uma chave por perfil, não por aparelho.
 *
 * Por aparelho seria mais correto em teoria — cada celular abriria o que é seu.
 * Na prática o webhook chega uma vez e teria de cifrar N vezes, uma por
 * aparelho, e um aparelho registrado depois nunca leria o que chegou antes. Com
 * uma chave por perfil, o aparelho que a gerou lê tudo, e trocar de celular
 * exige gerar de novo — o que apaga o histórico cifrado, e a tela avisa.
 *
 * `public_key` é X25519, 32 bytes em base64. A privada correspondente vive no
 * SecureStore do aparelho e não tem coluna aqui, hoje nem nunca.
 */
CREATE TABLE profile_keys (
  profile_id  UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  public_key  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Rotacionar (celular novo) descarta o que foi cifrado para a chave anterior:
  -- guardar bytes que ninguém mais abre é ocupar espaço com lixo indecifrável.
  rotated_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Mensagens diretas
-- ---------------------------------------------------------------------------

/*
 * Só o que o webhook entrega, e só a partir da conexão. A API do Instagram não
 * tem endpoint de histórico: o que existia antes de conectar não existe aqui, e
 * a tela precisa dizer isso para a lista vazia não parecer defeito.
 *
 * `message_id` é o id do Instagram e tem UNIQUE: o mesmo evento pode chegar duas
 * vezes (a Meta reentrega quando não recebe 200 a tempo) e a segunda entrega
 * não pode virar mensagem duplicada na tela.
 */
CREATE TABLE instagram_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_id   TEXT NOT NULL,
  -- Conversa a que pertence. Em claro: é a chave de agrupamento da tela.
  thread_id    TEXT NOT NULL,
  -- Quem mandou, do ponto de vista do dono da conta. Em claro: a tela separa
  -- "chegou" de "enviei" sem precisar abrir nada.
  from_self    BOOLEAN NOT NULL DEFAULT false,
  -- Id do remetente no Instagram (IGSID). Não é o @, e não vira @ em lugar
  -- nenhum: o app mostra o que veio cifrado dentro do payload.
  sender_id    TEXT,
  sent_at      TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Texto, rótulo de mídia e nome de quem mandou. Selado com a chave do perfil.
  payload_enc  TEXT NOT NULL,
  /*
   * Apagada sozinha. O modo fantasma serve para ler o que chegou agora, não para
   * o Rastro virar arquivo paralelo da caixa de entrada de alguém — o que seria
   * um passivo enorme e nenhuma funcionalidade.
   */
  expires_at   TIMESTAMPTZ NOT NULL,
  UNIQUE (profile_id, message_id)
);

CREATE INDEX instagram_messages_thread_idx
  ON instagram_messages (profile_id, thread_id, sent_at DESC);
CREATE INDEX instagram_messages_expira_idx ON instagram_messages (expires_at);

-- ---------------------------------------------------------------------------
-- Comentários recebidos
-- ---------------------------------------------------------------------------

/*
 * O espelho do que o export tem: lá estão os comentários que o usuário FEZ,
 * aqui os que ele RECEBEU. É a primeira fonte do produto com nome de terceiro
 * que interage — o export nunca traz isso (ver docs/EXPORT-INSTAGRAM.md).
 *
 * `parent_id` preenchido significa resposta a outro comentário.
 */
CREATE TABLE instagram_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comment_id   TEXT NOT NULL,
  media_id     TEXT,
  parent_id    TEXT,
  -- Comentário do próprio dono no próprio post. Separado para não contar como
  -- "alguém interagiu com você".
  from_self    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Texto e @ de quem comentou. Selado com a chave do perfil.
  payload_enc  TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  UNIQUE (profile_id, comment_id)
);

CREATE INDEX instagram_comments_recentes_idx
  ON instagram_comments (profile_id, created_at DESC);
CREATE INDEX instagram_comments_expira_idx ON instagram_comments (expires_at);
