import { Page } from '@playwright/test';

/**
 * Dispara drag-and-drop HTML5 con un DataTransfer compartido entre eventos.
 * Necesario porque Playwright.dragAndDrop() no propaga datos custom (setData/getData).
 */
export async function html5DragAndDrop(page: Page, sourceSelector: string, targetSelector: string) {
  await page.evaluate(
    ([source, target]) => {
      const sourceEl = document.querySelector(source) as HTMLElement | null;
      const targetEl = document.querySelector(target) as HTMLElement | null;
      if (!sourceEl || !targetEl) {
        throw new Error(`drag source/target not found: ${source} → ${target}`);
      }

      const dt = new DataTransfer();
      sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      targetEl.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      targetEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      targetEl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    [sourceSelector, targetSelector] as const,
  );
}
