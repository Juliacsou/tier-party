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

## v1.0
- Pontuação ajustada: se a resposta do jogador estiver correta, ele recebe `50 x quantidade de jogadores participantes`; os demais participantes recebem `+50`. O dono da resposta não recebe os `+50` adicionais da própria resposta.
- Jogadores com resposta errada ainda recebem `+50` por cada resposta correta dos demais jogadores.
- Home mobile redimensionada com logo, tipografia, campo de código e botões maiores; a tier decorativa permanece oculta no mobile.

## Correção de sessão em celulares (outubro/2026)

1. Execute `ATUALIZACAO_SESSAO.sql` no SQL Editor do Supabase **antes** de publicar esta versão.
2. Publique todos os arquivos atualizados, principalmente `app.js`.
3. Jogadores preservam a sessão por aba (`sessionStorage`) durante bloqueio de tela, segundo plano e recarga, até o encerramento da sessão do navegador. O botão Sair e a remoção pelo host continuam explícitos.
4. A coluna `left_voluntarily` impede que processos antigos de expiração de presença desativem jogadores por engano. A retomada reconecta as assinaturas em tempo real e consulta os dados da partida.
5. Limitação: navegadores podem descartar a aba inteira, e alguns restauram abas mesmo após reiniciar; o armazenamento de sessão é controlado pelo navegador. Teste em um aparelho real usando bloqueio prolongado e alternância de aplicativos.
6. Se existir uma rotina de banco que encerre *a partida inteira* quando o host perde o heartbeat, ela precisará ser ajustada separadamente; esta migração protege a sessão dos jogadores, não o encerramento automático de salas.
