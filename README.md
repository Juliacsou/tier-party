## v0.7 — Home e identidade visual

- Nova logo oficial Tier Party aplicada na Home e no cabeçalho do jogo.
- Home mobile empilhada: controles acima e tier list demonstrativa abaixo.
- Botões Host e Couch agora usam os mesmos ícones e textos da Home do Na Ordem!.

# Tier Party — Protótipo v0.3

Versão alinhada às regras de lógica do jogo **Na Ordem!**, mantendo a dinâmica e a identidade visual próprias do Tier Party.

## Alterações desta versão

- Tempo do host em passos de 30 segundos, sem limite máximo (mínimo de 30s).
- Quantidade de rodadas em botões `−` e `+`, de 1 em 1, sem limite máximo.
- Botão para compartilhar o link da partida no lobby.
- Jogador pode editar nome e cor depois de entrar.
- Sugestão de tema aparece no celular enquanto o host está escolhendo.
- Telas de espera do jogador usam animação de três bolinhas.
- Se o host fechar/navegar para fora da página, a partida é encerrada. Apenas trocar de aba não encerra.
- Sessão do jogador é persistida em `localStorage`; fechar/trocar de aba não o desconecta.
- Botões de editar perfil e desconectar ficam disponíveis no cabeçalho das telas do jogador.
- Mantida a regra de pontos da v0.2: cada acerto do grupo dá +50 individualmente a cada participante da rodada; o dono da resposta correta recebe +500 adicionais.

## Supabase

O `config.js` já está configurado com o projeto informado anteriormente. Esta atualização não exige alteração de SQL.


## v0.6
- Corrigido botão de editar nome/cor no lobby com eventos delegados.
- Campo de resposta não perde mais o foco durante polling/realtime.
- Botão de desconectar estabilizado em desktop e mobile.
- Edição de perfil permanece disponível somente no lobby.


## v0.6
- Corrige áreas decorativas que interceptavam toques no tablet/mobile.
- Garante área de toque mínima e prioridade de clique para Editar/Sair.
- Mantém os controles do jogador acima do conteúdo em todas as etapas.
- Exibe o cabeçalho do jogador e o botão Sair também no placar final.
- Ajusta safe-area para celulares/tablets com recortes de tela.
