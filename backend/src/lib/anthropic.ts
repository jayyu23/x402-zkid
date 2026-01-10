import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })
  }
  return client
}

export async function chat(message: string): Promise<string> {
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: message }]
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  return textBlock && textBlock.type === 'text' ? textBlock.text : ''
}
