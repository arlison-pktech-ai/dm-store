import { expect, test, type Page } from '@playwright/test';

/** Testes E2E no modo demonstração (sem Supabase): venda com pagamento misto e recebimento do fiado. */

async function bipar(page: Page, codigo: string) {
  await page.keyboard.type(codigo, { delay: 5 });
  await page.keyboard.press('Enter');
}

async function digitar(page: Page, valor: string) {
  for (const k of valor) await page.getByRole('button', { name: k, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __impressoes: number }).__impressoes = 0;
    window.print = () => { (window as unknown as { __impressoes: number }).__impressoes++; };
  });
  await page.goto('/terminal');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('venda: bipe antes da cliente não se perde, pagamento misto PIX + dinheiro com troco + fiado', async ({ page }) => {
  await page.getByRole('link', { name: /Vender/ }).click();
  await bipar(page, '7891000000017');
  await expect(page.getByText(/1 produto já guardado/)).toBeVisible();

  await page.getByRole('button', { name: /Rosa Almeida/ }).click();
  await expect(page.getByText('1 parcela atrasada', { exact: false })).toBeVisible();
  await bipar(page, '7891000000024');
  await bipar(page, '7891000000024');
  await expect(page.getByText('R$ 449,70').first()).toBeVisible();

  // Recarregar a página não perde o carrinho (RF-19)
  await page.reload();
  await expect(page.getByText('R$ 449,70').first()).toBeVisible();

  await page.getByRole('button', { name: /Ir para o pagamento/ }).click();
  await expect(page.getByTestId('falta')).toHaveText('R$ 449,70');

  await page.getByRole('button', { name: 'PIX', exact: true }).click();
  await page.getByRole('button', { name: 'Outro valor' }).click();
  await digitar(page, '150');
  await page.getByRole('button', { name: /^Lançar R\$ 150,00 no PIX/ }).click();
  await expect(page.getByTestId('falta')).toHaveText('R$ 299,70');

  await page.getByRole('button', { name: 'Dinheiro', exact: true }).click();
  await page.getByRole('button', { name: 'Outro valor' }).click();
  await digitar(page, '100');
  await page.getByRole('button', { name: /^Lançar R\$ 100,00 em dinheiro/ }).click();

  await page.getByRole('button', { name: /Restante no fiado/ }).click();
  await page.getByRole('button', { name: '2×' }).click();
  await page.getByRole('button', { name: /^Lançar R\$ 199,70 no fiado/ }).click();
  await expect(page.getByTestId('falta')).toHaveText('R$ 0,00');

  await page.getByRole('button', { name: /Concluir e imprimir/ }).click();
  await expect(page.getByRole('heading', { name: /Venda nº 000123 concluída/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __impressoes: number }).__impressoes)).toBe(1);

  // Fiado aparece na ficha: 60,00 antigo + 199,70 novo
  await page.goto('/terminal/clientes');
  await page.getByRole('button', { name: /Rosa Almeida/ }).first().click();
  await expect(page.getByText('R$ 259,70')).toBeVisible();
});

test('receber fiado: abate primeiro a parcela mais antiga e mostra o saldo', async ({ page }) => {
  await page.getByRole('link', { name: /Receber fiado/ }).click();
  await page.getByRole('button', { name: /Rosa Almeida/ }).first().click();
  await expect(page.getByText('Vencido R$ 60,00')).toBeVisible();
  await page.getByRole('button', { name: /Outro valor/ }).click();
  await digitar(page, '40');
  await expect(page.getByText('R$ 40,00 da parcela de')).toBeVisible();
  await page.getByRole('button', { name: /Confirmar e imprimir recibo/ }).click();
  await expect(page.getByText('ainda deve')).toContainText('R$ 20,00');
});

test('venda não conclui sem pagar tudo e código desconhecido oferece cadastro', async ({ page }) => {
  await page.goto('/terminal/venda');
  await page.getByRole('button', { name: /Fátima Souza/ }).click();
  await bipar(page, '1234567890');
  await expect(page.getByRole('dialog', { name: 'Produto não encontrado' })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar' }).click();
  await bipar(page, '7891000000048');
  await page.getByRole('button', { name: /Ir para o pagamento/ }).click();
  await page.getByRole('button', { name: 'Cartão', exact: true }).click();
  await page.getByRole('button', { name: 'Outro valor' }).click();
  await digitar(page, '50');
  await page.getByRole('button', { name: /^Lançar R\$ 50,00 no cartão/ }).click();
  await expect(page.getByRole('button', { name: /Concluir e imprimir/ })).toBeDisabled();
});

test('teclado físico funciona onde há teclado na tela, e o leitor não digita no valor', async ({ page }) => {
  await page.getByRole('link', { name: /Receber fiado/ }).click();
  await page.getByRole('button', { name: /Rosa Almeida/ }).first().click();
  await page.getByRole('button', { name: /Outro valor/ }).click();
  await page.keyboard.type('25.5', { delay: 100 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('7', { delay: 100 });
  await expect(page.getByText('R$ 25,70', { exact: true })).toBeVisible();
  await bipar(page, '7891000000017');
  await page.waitForTimeout(300);
  await expect(page.getByText('R$ 25,70', { exact: true })).toBeVisible();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('40', { delay: 100 });
  await expect(page.getByText('R$ 40,00 da parcela de')).toBeVisible();
});

test('chegou mercadoria aceita quantidade com mais de um dígito (tela e teclado físico)', async ({ page }) => {
  await page.goto('/terminal/mercadoria');
  await bipar(page, '7891000000024');
  await expect(page.getByText('Quantidade que chegou')).toBeVisible();
  await digitar(page, '12');
  await expect(page.getByText('Total: R$ 744,00')).toBeVisible();
  await page.keyboard.press('Backspace');
  await page.keyboard.type('05', { delay: 100 });
  await expect(page.getByText('Total: R$ 6.510,00')).toBeVisible();
  await page.getByRole('button', { name: /Pôr na lista/ }).click();
  await expect(page.getByText('105 un.', { exact: false })).toBeVisible();
});

test('estoque: contagem só ajusta depois de terminar e confirmar com PIN', async ({ page }) => {
  await page.getByRole('link', { name: /Estoque/ }).click();
  const ambar = page.getByTestId('linha-estoque').filter({ hasText: 'Essência Âmbar' });
  await expect(ambar).toContainText('1 un.');
  await page.getByRole('button', { name: /Contar estoque/ }).click();

  await bipar(page, '7891000000017');
  await bipar(page, '7891000000017');
  await bipar(page, '7891000000017');
  await bipar(page, '7891000000024');
  const linhaAmbar = page.getByTestId('linha-contagem').filter({ hasText: 'Essência Âmbar' });
  await expect(linhaAmbar.getByTestId('diferenca')).toHaveText('+2');
  await page.getByTestId('linha-contagem').filter({ hasText: 'Flor de Lótus' }).getByRole('button', { name: 'Digitar quantidade' }).click();
  await digitar(page, '12');
  await page.getByRole('button', { name: /Usar esta quantidade/ }).click();

  // Sair no meio não muda nada; a contagem continua guardada
  await page.getByRole('link', { name: 'Estoque' }).click();
  await expect(ambar).toContainText('1 un.');
  await page.getByRole('button', { name: /Continuar contagem/ }).click();
  await expect(linhaAmbar).toBeVisible();

  await page.getByRole('button', { name: /Terminar contagem/ }).click();
  await expect(page.getByText('de 1 para 3')).toBeVisible();
  await expect(page.getByText('de 0 para 12')).toBeVisible();
  await page.getByRole('button', { name: /Confirmar e ajustar/ }).click();
  await digitar(page, '1234');
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('Estoque ajustado: 2 produtos.')).toBeVisible();
  await expect(ambar).toContainText('3 un.');
  await expect(page.getByTestId('linha-estoque').filter({ hasText: 'Flor de Lótus' })).toContainText('12 un.');
});

test('estoque: dar entrada a partir da lista abre a quantidade do produto', async ({ page }) => {
  await page.goto('/terminal/estoque');
  await page.getByTestId('linha-estoque').filter({ hasText: 'Flor de Lótus' }).getByRole('button', { name: 'Dar entrada' }).click();
  await expect(page.getByRole('dialog', { name: /Flor de Lótus/ })).toBeVisible();
});

test('cartão aceita valor maior (taxa repassada) sem mudar o total, e o teclado não cobre as parcelas', async ({ page }) => {
  await page.getByRole('link', { name: /Vender/ }).click();
  await page.getByRole('button', { name: /Rosa Almeida/ }).click();
  await bipar(page, '7891000000024');
  await expect(page.getByText('R$ 129,90').first()).toBeVisible();
  await page.getByRole('button', { name: /Ir para o pagamento/ }).click();

  await page.getByRole('button', { name: 'Cartão', exact: true }).click();
  await page.getByRole('button', { name: 'Outro valor' }).click();
  await digitar(page, '136,40');
  await expect(page.getByText('Passar na maquininha')).toContainText('R$ 136,40');
  await expect(page.getByText('taxa repassada R$ 6,50')).toBeVisible();

  // Parcelas e botão Lançar não se sobrepõem
  const oito = await page.getByRole('button', { name: '8×', exact: true }).boundingBox();
  const lancar = await page.getByRole('button', { name: /^Lançar R\$ 129,90 no cartão/ }).boundingBox();
  expect(oito!.y + oito!.height).toBeLessThanOrEqual(lancar!.y);

  await page.getByRole('button', { name: '3×', exact: true }).click();
  await page.getByRole('button', { name: /^Lançar R\$ 129,90 no cartão/ }).click();
  await expect(page.getByTestId('falta')).toHaveText('R$ 0,00');
  await expect(page.getByText('passou R$ 136,40 (taxa R$ 6,50)')).toBeVisible();
  await page.getByRole('button', { name: /Concluir e imprimir/ }).click();
  await expect(page.getByRole('heading', { name: /concluída/ })).toBeVisible();
});

test('preços: muda vários e salva com PIN; nada muda antes de salvar', async ({ page }) => {
  await page.goto('/terminal/estoque');
  await page.getByRole('button', { name: 'Atualizar preços' }).click();
  await bipar(page, '7891000000024');
  await expect(page.getByRole('dialog', { name: /Novo preço · Flor de Lótus/ })).toBeVisible();
  await digitar(page, '139,90');
  await page.getByRole('button', { name: /Usar este preço/ }).click();
  const lotus = page.getByTestId('linha-preco').filter({ hasText: 'Flor de Lótus' });
  await expect(lotus).toContainText('R$ 139,90');
  await page.getByRole('button', { name: /Salvar preços/ }).click();
  await digitar(page, '1234');
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('Preços salvos: 1.')).toBeVisible();

  // A venda já usa o preço novo
  await page.goto('/terminal/venda');
  await page.getByRole('button', { name: /Rosa Almeida/ }).click();
  await bipar(page, '7891000000024');
  await expect(page.getByText('R$ 139,90').first()).toBeVisible();
});

test('venda: corrigir o preço de um item com PIN vale só para esta venda', async ({ page }) => {
  await page.goto('/terminal/venda');
  await page.getByRole('button', { name: /Rosa Almeida/ }).click();
  await bipar(page, '7891000000024');
  await page.getByRole('button', { name: /Corrigir preço de Flor de Lótus/ }).click();
  await digitar(page, '119,90');
  await page.getByRole('button', { name: /Continuar com o PIN/ }).click();
  await digitar(page, '9999');
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('PIN incorreto.')).toBeVisible();
  await page.getByRole('button', { name: 'Apagar' }).click();
  await page.getByRole('button', { name: 'Apagar' }).click();
  await page.getByRole('button', { name: 'Apagar' }).click();
  await page.getByRole('button', { name: 'Apagar' }).click();
  await digitar(page, '1234');
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('era R$ 129,90 cada')).toBeVisible();

  await page.getByRole('button', { name: /Ir para o pagamento/ }).click();
  await expect(page.getByTestId('falta')).toHaveText('R$ 119,90');
  await page.getByRole('button', { name: 'PIX', exact: true }).click();
  await page.getByRole('button', { name: /^Lançar R\$ 119,90 no PIX/ }).click();
  await page.getByRole('button', { name: /Concluir e imprimir/ }).click();
  await expect(page.getByRole('heading', { name: /concluída/ })).toBeVisible();

  // O cadastro continua com o preço antigo
  await page.goto('/terminal/precos');
  await expect(page.getByTestId('linha-preco').filter({ hasText: 'Flor de Lótus' })).toContainText('R$ 129,90');
});
