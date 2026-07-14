-- Restringe a exclusão de contatos a admin/owner.
--
-- contacts_delete permitia qualquer 'agent' apagar um contato — e, por
-- cascade (conversations.contact_id / messages.conversation_id são
-- ON DELETE CASCADE), o histórico inteiro de conversa junto. Isso é
-- destrutivo demais para o nível de permissão que também cobre "enviar
-- mensagem" e "criar contato". Restringe só o DELETE a admin+; SELECT/
-- INSERT/UPDATE continuam em 'agent' (migration 017_account_sharing.sql).
DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (is_account_member(account_id, 'admin'));
