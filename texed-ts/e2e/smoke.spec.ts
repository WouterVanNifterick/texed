import { expect, test } from '@playwright/test';

const IGNORED_ERRORS = [
  'Permission to use Web MIDI API was not granted.',
  'NotAllowedError: Permission to use Web MIDI API was not granted.',
];

function isIgnoredError(message: string): boolean {
  return IGNORED_ERRORS.some((ignored) => message.includes(ignored));
}

test('app boots, renders the rack, and a key press starts audio cleanly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    if (!isIgnoredError(String(err))) errors.push(String(err));
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isIgnoredError(msg.text())) {
      errors.push(msg.text());
    }
  });

  await page.goto('./');
  await expect(page).toHaveTitle('Texed');
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));

  await page.getByRole('button', { name: "LET'S PLAY!" }).click();

  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' });
  await expect(keyboard).toBeVisible();

  const key = keyboard.getByRole('button', { name: 'Note 60' });
  await key.click();
  await expect(key).not.toHaveClass(/active/);

  expect(errors).toEqual([]);
});
