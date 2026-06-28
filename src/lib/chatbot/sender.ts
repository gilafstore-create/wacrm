import { engineSendText, engineSendInteractiveMenu } from '@/lib/automations/meta-send'

export interface ChatCtx {
  userId: string
  conversationId: string
  contactId: string
}

export interface MenuOption {
  id: string
  title: string
  description?: string
}

export async function sendText(ctx: ChatCtx, text: string): Promise<void> {
  await engineSendText({ ...ctx, text })
}

export async function sendButtons(
  ctx: ChatCtx,
  body: string,
  options: MenuOption[],
  opts?: { header?: string; footer?: string },
): Promise<void> {
  await engineSendInteractiveMenu({
    ...ctx,
    menuType: 'buttons',
    body,
    options: options.slice(0, 3),
    header: opts?.header,
    footer: opts?.footer,
  })
}

export async function sendList(
  ctx: ChatCtx,
  body: string,
  options: MenuOption[],
  opts?: { header?: string; footer?: string; buttonText?: string },
): Promise<void> {
  await engineSendInteractiveMenu({
    ...ctx,
    menuType: 'list',
    body,
    options: options.slice(0, 10),
    header: opts?.header,
    footer: opts?.footer,
    buttonText: opts?.buttonText ?? 'View Options',
  })
}
