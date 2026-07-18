import assert from 'node:assert/strict'
import test from 'node:test'
import { ProviderRouter } from '../src/providers/provider-router.js'

function provider(protocolType) {
  return {
    protocolType,
    listModels: async profile => [`${protocolType}:${profile.baseUrl}`],
    streamChat: async () => ({ finishReason: protocolType }),
    generateImage: async () => ({ images: [{ protocolType }] })
  }
}

test('routes legacy profiles to OpenAI and Gemini profiles to Gemini', async () => {
  const router = new ProviderRouter({
    providers: [provider('openai-compatible'), provider('gemini')]
  })

  assert.deepEqual(await router.listModels({ baseUrl: 'legacy' }), ['openai-compatible:legacy'])
  assert.deepEqual(await router.listModels({ protocolType: 'gemini', baseUrl: 'native' }), ['gemini:native'])
  assert.equal((await router.streamChat({ protocolType: 'gemini' })).finishReason, 'gemini')
  assert.equal((await router.generateImage({ protocolType: 'openai-compatible' })).images[0].protocolType, 'openai-compatible')
})

test('rejects unsupported or missing provider implementations', () => {
  const router = new ProviderRouter({ providers: [provider('openai-compatible')] })
  assert.throws(() => router.listModels({ protocolType: 'gemini' }), /未提供 gemini/)
  assert.throws(() => router.resolve({ protocolType: 'unknown' }), /不支持的接口格式/)
})
