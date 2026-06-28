import type { ChatCtx } from '../sender'
import { sendList } from '../sender'

export async function sendMainMenu(ctx: ChatCtx): Promise<void> {
  await sendList(
    ctx,
    'Welcome to Gilaf Store! 🌿 I\'m your AI assistant. How can I help you today?',
    [
      { id: 'track_order', title: '📦 Track Order',       description: 'Check your order status' },
      { id: 'products',    title: '🛍️ Products',           description: 'Browse our product range' },
      { id: 'returns',     title: '🔄 Returns',            description: 'Return policy & requests' },
      { id: 'support',     title: '🎧 Support',            description: 'Get help with an issue' },
      { id: 'feedback',    title: '💡 Help Us Improve',    description: 'Share your feedback' },
      { id: 'app_store',   title: '📱 App Store',          description: 'Download our mobile app' },
    ],
    {
      header: 'Gilaf Store 🌿',
      footer: 'Reply "menu" anytime to return here',
      buttonText: 'View Options',
    },
  )
}
