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
