import { h, ref, watch } from 'vue'

const objectFitByMode = {
  aspectFill: 'cover',
  aspectFit: 'contain'
}

const ProviderLogo = {
  name: 'ProviderLogo',
  inheritAttrs: false,
  props: {
    src: { type: String, required: true },
    alt: { type: String, default: '' },
    mode: { type: String, default: 'aspectFill' },
    lazyLoad: { type: Boolean, default: false },
    fallbackSrc: { type: String, default: '/static/zhiyu-logo.png' }
  },
  setup(props, { attrs }) {
    const resolvedSrc = ref(props.src || props.fallbackSrc)

    watch(
      () => props.src,
      value => {
        resolvedSrc.value = value || props.fallbackSrc
      }
    )

    const handleError = event => {
      if (resolvedSrc.value !== props.fallbackSrc) {
        resolvedSrc.value = props.fallbackSrc
      }

      const listeners = Array.isArray(attrs.onError) ? attrs.onError : [attrs.onError]
      listeners.filter(listener => typeof listener === 'function').forEach(listener => listener(event))
    }

    return () => {
      const isApp = typeof plus !== 'undefined'
      const tag = isApp ? 'image' : 'img'
      const elementProps = {
        ...attrs,
        src: resolvedSrc.value,
        onError: handleError,
        style: isApp
          ? attrs.style
          : [attrs.style, { objectFit: objectFitByMode[props.mode] || 'cover' }]
      }

      if (isApp) {
        elementProps.mode = props.mode
        if (props.lazyLoad) elementProps['lazy-load'] = true
      } else {
        elementProps.alt = props.alt
        if (props.lazyLoad) {
          elementProps.loading = 'lazy'
          elementProps.decoding = 'async'
        }
      }

      return h(tag, elementProps)
    }
  }
}

export default ProviderLogo
