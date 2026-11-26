# Cosmético Leva

Vitrine com 59 referências, carrinho no navegador e painel de pedidos protegido por login. Cada unidade custa R$ 190,00. O servidor confirma o número do pedido assim que o registra no banco.

## Rodar no computador da loja

1. Use o Node.js 24 ou superior e execute `npm install`.
2. Copie `.env.example` para `.env` e preencha `ADMIN_USER`, `ADMIN_PASSWORD` e `CUSTOMER_PIN_SECRET`. Escolha uma senha do painel com pelo menos 12 caracteres e use um segredo aleatório de pelo menos 32 caracteres para as senhas dos clientes. Para gerar o segredo localmente, execute `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` e cole o resultado em `CUSTOMER_PIN_SECRET`. Preserve o mesmo segredo ao migrar contas para a Neon.
3. Execute `npm start` na pasta do projeto.
4. Abra [a vitrine local](http://127.0.0.1:3000/) e entre no [painel do proprietário](http://127.0.0.1:3000/painel) com as credenciais definidas.

Sem `DATABASE_URL`, os pedidos ficam em `data/pedidos.sqlite` e as migrações locais são aplicadas na inicialização. Preserve a pasta `data/` entre reinícios e atualizações e faça backups com o servidor parado. O painel lista os pedidos mais recentes primeiro. Abra um pedido e selecione **Imprimir pedido** para abrir a versão formatada. Nela, selecione **Imprimir pedido** e escolha uma impressora ou **Salvar como PDF** no navegador.

## Teste automatizado

Com Node.js 24, execute `npm ci` e `npm test`. O mesmo teste roda na aba **Actions** do GitHub a cada envio de código. Ele usa SQLite em memória e SMTP local de teste para validar o checkout de R$ 570,00, o link de confirmação, o login, o painel e o rastreio. Nenhuma credencial da Neon ou do Gmail é necessária.

## PostgreSQL da Neon

Preencha `DATABASE_URL` com a conexão do PostgreSQL fornecida pela Neon. Guarde a URL no `.env` local ou nas variáveis da hospedagem. Execute `npm run db:migrate` antes de iniciar o servidor com PostgreSQL.

Para transferir os pedidos existentes, execute `npm run db:import-sqlite` com `DATABASE_URL` apontando para o destino já migrado. Por padrão, o comando lê `data/pedidos.sqlite` ou o caminho definido por `DB_PATH`. Para indicar outra origem, use `npm run db:import-sqlite -- "caminho/para/pedidos.sqlite"`. O comando abre o arquivo somente para leitura, preserva os números dos pedidos e pode ser repetido. Faça a primeira importação antes de receber novos pedidos na Neon. Se houver um número já usado por outro pedido, a importação inteira é revertida. Pedidos antigos sem e-mail verificado continuam disponíveis somente no painel do proprietário.

## E-mail de identificação e rastreio

Configure `SMTP_URL` com a URL do provedor SMTP (por exemplo, `smtps://usuario:senha@smtp.exemplo.com:465`) e `MAIL_FROM` com um remetente autorizado pelo provedor. Para SMTP remoto, use TLS. Um servidor SMTP de testes pode ser usado em loopback sem credenciais. O checkout e a recuperação de senha enviam links de uso único, válidos por 30 minutos. Em rede local ou em produção, use `APP_PUBLIC_URL` para definir o endereço que o cliente pode abrir. Sem esse campo, a loja usa `http://127.0.0.1` e a porta local. Para produção, use HTTPS. O painel permite reenviar o e-mail de rastreio após falha.

## Validar em dois aparelhos

Para um teste com dados fictícios em uma rede local confiável, defina `HOST=0.0.0.0` e `SECURE_COOKIE=false` no `.env`. Reinicie o servidor e abra no celular `http://IP-DO-COMPUTADOR:3000`, usando o IP do computador na mesma rede. O computador precisa permanecer ligado e aceitar conexões locais na porta configurada.

1. No celular, adicione duas unidades do Produto 001 e uma do Produto 008. Confirme o total de R$ 570,00 e que **Voltar às compras** preserva os itens.
2. Preencha nome, CPF, e-mail, senha de quatro dígitos, WhatsApp e endereço de teste. Abra o link recebido para confirmar o e-mail e anote o número exibido em Meus pedidos.
3. No computador, abra o painel, atualize a lista e abra o pedido com o mesmo número. Confira os dados e a impressão.

## Hospedagem para clientes

Use uma hospedagem que execute Node.js 24+ e configure `DATABASE_URL` para usar a Neon. Se usar SQLite, preserve `data/` em um volume persistente ou aponte `DB_PATH` para o arquivo nesse volume. Forneça as credenciais pelas variáveis de ambiente da hospedagem. Use `SECURE_COOKIE=true` e acesse a loja e o painel por HTTPS. Use uma única instância do aplicativo para compartilhar as sessões do painel.

O endereço em texto está pendente. Quando for confirmado, substitua `Endereço a confirmar` em `public/index.html`. O botão **Como chegar** já aponta para o link fornecido.
