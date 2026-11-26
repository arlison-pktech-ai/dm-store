# Instalar o terminal (mini PC com Windows)

Objetivo: ligar o computador e o PDV já aparecer em tela cheia, sem login, senha ou janela do Windows.

## Windows

1. Crie um usuário local (ex.: `Loja`) sem senha e ative o **login automático**
   (`netplwiz` › desmarque "Os usuários devem digitar um nome de usuário e uma senha").
2. *Energia*: tela e suspensão em **Nunca**.
3. *Windows Update › Opções avançadas › Horário ativo*: cobre todo o horário da loja.
4. *Notificações*: desligadas. *Assistente de foco*: só alarmes.
5. Leitor USB em **modo teclado**, com sufixo **Enter** (vem assim de fábrica na maioria).

## Impressora térmica 80 mm

1. Instale o driver e defina a impressora como **padrão do Windows**.
2. No driver: papel **80 mm**, margens zero e **corte no fim do documento**.
3. Imprima uma página de teste.

## Chrome em quiosque na inicialização

1. Instale o Chrome.
2. Pressione `Win + R`, digite `shell:startup` e crie ali um atalho com o destino:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing --disable-pinch --overscroll-history-navigation=0 --noerrdialogs --disable-session-crashed-bubble https://pdv.seudominio.com.br/terminal
   ```

   - `--kiosk`: tela cheia, sem barra.
   - `--kiosk-printing`: o cupom vai direto para a impressora padrão, sem janela.
3. Reinicie. Na primeira vez aparece **Ativar este terminal**: entre com o usuário do terminal
   (papel `terminal`). A sessão se renova sozinha e a tela não volta a aparecer.

Para sair do quiosque (manutenção): `Alt + F4`.

## Conferência final

- [ ] Ligar o mini PC abre o PDV sem tocar em nada.
- [ ] Bipar um produto na tela de venda faz o bipe e o item pisca em verde.
- [ ] Uma venda de teste imprime o cupom sozinho, cortado.
- [ ] Desligar o Wi-Fi mostra a faixa vermelha "Sem internet" e o carrinho continua lá.
