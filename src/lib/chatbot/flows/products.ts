import type { ChatCtx } from '../sender'
import { sendText, sendList } from '../sender'
import { setFlowState, resetFlowState } from '../state'
import { getCategories, getProductsByCategory } from '../gilafstore-api'

export async function handleProducts(
  ctx: ChatCtx,
  step: string | null,
  context: Record<string, unknown>,
  optionId: string | undefined,
): Promise<void> {
  // ── Entry: show categories ─────────────────────────────────────────────────
  if (!step || step === 'start') {
    const categories = await getCategories()
    const options = categories.slice(0, 10).map((c) => ({
      id: c.id,
      title: c.name,
    }))

    await sendList(ctx, '🛍️ Which product category are you interested in?', options, {
      header: 'Our Products',
      footer: 'Type "menu" to go back',
      buttonText: 'Choose Category',
    })
    await setFlowState(ctx.userId, ctx.contactId, {
      flow: 'products',
      step: 'waiting_category',
      context: {},
    })
    return
  }

  // ── Category selected ──────────────────────────────────────────────────────
  if (step === 'waiting_category' && optionId) {
    await sendText(ctx, '⏳ Fetching products...')
    const products = await getProductsByCategory(optionId)

    if (!products.length) {
      await sendText(
        ctx,
        '😔 No products found in this category right now. Type *menu* to browse other options.',
      )
      await resetFlowState(ctx.userId, ctx.contactId)
      return
    }

    const options = products.slice(0, 10).map((p) => ({
      id: `product_${p.id}`,
      title: p.name,
      description: `${p.price}${p.in_stock ? '' : ' • Out of Stock'}`,
    }))

    await sendList(
      ctx,
      `Here are the products in this category. Tap one for details:`,
      options,
      {
        header: '🛍️ Products',
        footer: 'Type "menu" to go back',
        buttonText: 'View Product',
      },
    )
    await setFlowState(ctx.userId, ctx.contactId, {
      flow: 'products',
      step: 'waiting_product',
      context: { categoryId: optionId },
    })
    return
  }

  // ── Product selected ───────────────────────────────────────────────────────
  if (step === 'waiting_product' && optionId?.startsWith('product_')) {
    const productId = optionId.replace('product_', '')
    const categoryId = (context.categoryId as string | undefined) ?? ''
    const products = await getProductsByCategory(categoryId)
    const product = products.find((p) => p.id === productId)

    if (!product) {
      await sendText(ctx, '❌ Product not found. Type *menu* to continue.')
      await resetFlowState(ctx.userId, ctx.contactId)
      return
    }

    let msg = `🛍️ *${product.name}*\n\n`
    if (product.description) msg += `${product.description}\n\n`
    msg += `💰 Price: *${product.price}*\n`
    msg += `📦 Availability: ${product.in_stock ? '✅ In Stock' : '❌ Out of Stock'}\n`
    msg += `\n🔗 View & Order: ${product.product_url}`
    msg += '\n\nType *menu* to return to the main menu.'

    await sendText(ctx, msg)

    if (product.image_url) {
      await sendText(ctx, product.image_url)
    }

    await resetFlowState(ctx.userId, ctx.contactId)
    return
  }
}
