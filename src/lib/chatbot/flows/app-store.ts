import type { ChatCtx } from '../sender'
import { sendText } from '../sender'
import { resetFlowState } from '../state'

const ANDROID_URL = process.env.GILAFSTORE_ANDROID_URL ?? 'https://play.google.com/store/apps/details?id=com.gilafstore'
const IOS_URL     = process.env.GILAFSTORE_IOS_URL     ?? 'https://apps.apple.com/app/gilaf-store/id0000000000'

export async function handleAppStore(ctx: ChatCtx): Promise<void> {
  await sendText(
    ctx,
    '📱 *Download the Gilaf Store App*\n\n'
    + 'Get exclusive app-only deals, track orders, and shop our full range!\n\n'
    + `🤖 *Android (Play Store):*\n${ANDROID_URL}\n\n`
    + `🍎 *iOS (App Store):*\n${IOS_URL}\n\n`
    + '✨ Features:\n'
    + '• Real-time order tracking\n'
    + '• Exclusive app discounts\n'
    + '• Quick reorder\n'
    + '• Push notifications for deals\n\n'
    + 'Type *menu* to return to the main menu.',
  )
  await resetFlowState(ctx.userId, ctx.contactId)
}
