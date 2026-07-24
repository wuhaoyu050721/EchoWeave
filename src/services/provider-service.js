import { normalizeProviderAvatar } from '../core/provider-avatar.js'
import { resolveChatRequestTimeout } from '../core/model-request-timeout.js'
import { normalizeProviderBaseUrl, normalizeProviderProtocol } from '../core/provider-protocol.js'
import { createRuntimeId } from '../core/runtime-id.js'

function toPublicProvider(provider) {
  if (!provider) return null
  const { encryptedApiKey, ...publicFields } = provider
  return { ...publicFields, hasApiKey: Boolean(encryptedApiKey) }
}

export class ProviderService {
  constructor({ repository, vault, provider, idFactory = createRuntimeId, now = () => new Date().toISOString() } = {}) {
    this.repository = repository
    this.vault = vault
    this.provider = provider
    this.idFactory = idFactory
    this.now = now
  }

  async listProviders() {
    return (await this.repository.listProviders()).map(toPublicProvider)
  }

  async getApiKeyForEditing(id) {
    const provider = await this.repository.getProvider(id)
    if (!provider) throw new Error('当前接口不存在')
    return provider.encryptedApiKey
      ? await this.vault.decryptString(provider.encryptedApiKey)
      : ''
  }

  async saveProvider(form) {
    const name = String(form?.name ?? '').trim()
    const defaultModel = String(form?.defaultModel ?? form?.model ?? '').trim()
    if (!name) throw new Error('接口名称不能为空')
    if (!defaultModel) throw new Error('默认模型不能为空')

    const existing = form.id ? await this.repository.getProvider(form.id) : null
    const protocolType = normalizeProviderProtocol(form.protocolType ?? existing?.protocolType)
    const apiKey = String(form.apiKey ?? '').trim()
    const encryptedApiKey = apiKey
      ? await this.vault.encryptString(apiKey)
      : existing?.encryptedApiKey ?? null
    const avatarInput = form.avatar === undefined ? existing?.avatar : form.avatar
    const avatar = normalizeProviderAvatar(avatarInput, { strict: true })
    const timestamp = this.now()
    const record = {
      ...existing,
      id: form.id || this.idFactory(),
      name,
      protocolType,
      baseUrl: normalizeProviderBaseUrl(form.baseUrl, protocolType),
      encryptedApiKey,
      defaultModel,
      modelsCache: Array.isArray(form.modelsCache) ? [...form.modelsCache] : existing?.modelsCache ?? [],
      avatar,
      requestTimeout: resolveChatRequestTimeout({
        requestTimeout: form.requestTimeout ?? existing?.requestTimeout
      }),
      streamEnabled: form.streamEnabled ?? existing?.streamEnabled ?? true,
      lastTestStatus: existing?.lastTestStatus ?? 'untested',
      lastTestError: existing?.lastTestError ?? '',
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      deletedAt: null
    }
    await this.repository.saveProvider(record)
    return toPublicProvider(record)
  }

  async setDefaultModel(id, model) {
    const defaultModel = String(model ?? '').trim()
    if (!defaultModel) throw new Error('默认模型不能为空')

    const existing = await this.repository.getProvider(id)
    if (!existing) throw new Error('当前接口不存在')

    const updated = {
      ...existing,
      defaultModel,
      updatedAt: this.now()
    }
    await this.repository.saveProvider(updated)
    return toPublicProvider(updated)
  }

  async deleteProvider(id) {
    await this.repository.deleteProvider(id)
  }

  async getRequestProfile(id) {
    const provider = await this.repository.getProvider(id)
    if (!provider) throw new Error('当前接口不存在')
    return {
      ...provider,
      apiKey: provider.encryptedApiKey ? await this.vault.decryptString(provider.encryptedApiKey) : ''
    }
  }

  async fetchModels(form) {
    const existing = form?.id ? await this.repository.getProvider(form.id) : null
    const protocolType = normalizeProviderProtocol(form?.protocolType ?? existing?.protocolType)
    const temporaryKey = String(form?.apiKey ?? '').trim()
    const apiKey = temporaryKey || (
      existing?.encryptedApiKey
        ? await this.vault.decryptString(existing.encryptedApiKey)
        : ''
    )
    return this.provider.listModels({
      id: form?.id ?? null,
      protocolType,
      baseUrl: normalizeProviderBaseUrl(form?.baseUrl ?? existing?.baseUrl, protocolType),
      apiKey,
      defaultModel: String(form?.defaultModel ?? existing?.defaultModel ?? '').trim()
    })
  }

  async testConnection(id) {
    const record = await this.repository.getProvider(id)
    if (!record) throw new Error('当前接口不存在')
    try {
      const requestProfile = await this.getRequestProfile(id)
      const models = await this.provider.listModels(requestProfile)
      const updated = {
        ...record,
        modelsCache: models,
        lastTestStatus: 'success',
        lastTestError: '',
        updatedAt: this.now()
      }
      await this.repository.saveProvider(updated)
      return toPublicProvider(updated)
    } catch (error) {
      await this.repository.saveProvider({
        ...record,
        lastTestStatus: 'failed',
        lastTestError: error.message,
        updatedAt: this.now()
      })
      throw error
    }
  }
}
