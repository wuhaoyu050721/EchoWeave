import { normalizeProviderProtocol } from '../core/provider-protocol.js'

export class ProviderRouter {
  constructor({ providers = [] } = {}) {
    this.providers = new Map()
    for (const provider of providers) {
      if (!provider?.protocolType) throw new Error('ProviderRouter 中的接口缺少 protocolType')
      this.providers.set(normalizeProviderProtocol(provider.protocolType), provider)
    }
  }

  resolve(profile = {}) {
    const protocolType = normalizeProviderProtocol(profile.protocolType)
    const provider = this.providers.get(protocolType)
    if (!provider) throw new Error(`当前安装包未提供 ${protocolType} 接口实现`)
    return provider
  }

  listModels(profile) {
    return this.resolve(profile).listModels(profile)
  }

  testConnection(profile) {
    const provider = this.resolve(profile)
    return typeof provider.testConnection === 'function'
      ? provider.testConnection(profile)
      : provider.listModels(profile)
  }

  streamChat(profile, request, handlers) {
    return this.resolve(profile).streamChat(profile, request, handlers)
  }

  generateImage(profile, request, handlers) {
    const provider = this.resolve(profile)
    if (typeof provider.generateImage !== 'function') throw new Error('当前接口不支持生图协议')
    return provider.generateImage(profile, request, handlers)
  }
}
