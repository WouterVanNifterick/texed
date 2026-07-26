import { expect, test, type Page } from '@playwright/test';

const IGNORED_ERRORS = [
  'Permission to use Web MIDI API was not granted.',
  'NotAllowedError: Permission to use Web MIDI API was not granted.',
];

function isIgnoredError(message: string): boolean {
  return IGNORED_ERRORS.some((ignored) => message.includes(ignored));
}

/** Collect page errors so a test can assert the run stayed clean. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    if (!isIgnoredError(String(err))) errors.push(String(err));
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isIgnoredError(msg.text())) errors.push(msg.text());
  });
  return errors;
}

/** Audio needs a user gesture, so every visit starts behind the splash. */
async function start(page: Page): Promise<void> {
  await page.getByRole('button', { name: "LET'S PLAY!" }).click();
  await expect(page.getByRole('group', { name: 'On-screen keyboard' })).toBeVisible();
}

test('app boots, renders the rack, and a key press starts audio cleanly', async ({ page }) => {
  const errors = watchErrors(page);

  await page.goto('./');
  await expect(page).toHaveTitle('Texed');
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));

  await start(page);

  const key = page
    .getByRole('group', { name: 'On-screen keyboard' })
    .getByRole('button', { name: 'Note 60' });
  await key.click();
  await expect(key).not.toHaveClass(/active/);

  expect(errors).toEqual([]);
});

test('loads a library bank, edits a parameter, saves it, and restores on reload', async ({
  page,
}) => {
  const errors = watchErrors(page);

  await page.goto('./');
  await start(page);

  // Load a bank out of the built-in library into voice memory.
  await page.getByRole('button', { name: 'LIBRARY' }).click();
  const library = page.getByRole('dialog', { name: 'Patch library' });
  await expect(library).toBeVisible();
  const firstVoice = await library.getByRole('button', { name: /^001 / }).textContent();
  const voiceName = (firstVoice ?? '').replace(/^001\s*/, '');
  await library.getByRole('button', { name: 'LOAD ALL 128' }).click();
  await library.getByRole('button', { name: 'CLOSE' }).click();
  await expect(library).toBeHidden();

  // The loaded voices show up in the program selector.
  const programs = page.locator('.program-select');
  await expect(programs).toContainText(voiceName);

  // Edit a parameter with the keyboard and read the new value back.
  const algo = page.getByRole('slider', { name: 'ALGO' });
  await algo.focus();
  const before = Number(await algo.getAttribute('aria-valuenow'));
  await algo.press('ArrowUp');
  const edited = String(before + 1);
  await expect(algo).toHaveAttribute('aria-valuenow', edited);

  // Save the edited voice as .syx.
  await page.getByRole('button', { name: 'Save' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /Save voice/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.syx$/);

  // The session snapshot is debounced, so give it time to land before reloading.
  await page.waitForTimeout(2500);
  await page.reload();
  await start(page);

  await expect(page.getByRole('slider', { name: 'ALGO' })).toHaveAttribute('aria-valuenow', edited);
  await expect(page.locator('.program-select')).toContainText(voiceName);

  expect(errors).toEqual([]);
});
