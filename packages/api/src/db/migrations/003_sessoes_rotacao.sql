-- Rotação de refresh token com detecção de reuso.
--
-- Um refresh token vale 60 dias. Se vazar, o ladrão tem 60 dias de acesso e
-- ninguém percebe. A defesa padrão (OAuth 2.0 BCP) é rotacionar: cada uso
-- devolve um token novo e mata o anterior. O token antigo, se reaparecer, só
-- pode ter vindo de uma cópia — e aí toda a linhagem cai.
--
-- `family_id` é o que liga as gerações. Sem ele, "revogar a linhagem" viraria
-- "revogar tudo do usuário", e um refresh duplicado por rede instável derrubaria
-- a sessão do celular e do tablet junto.

ALTER TABLE sessions ADD COLUMN family_id UUID;

-- As sessões que já existem viram cada uma a sua própria linhagem.
UPDATE sessions SET family_id = id WHERE family_id IS NULL;

ALTER TABLE sessions ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX sessions_family_idx ON sessions (family_id);
