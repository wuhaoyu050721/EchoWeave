import { h } from 'vue'

const objectFitByMode = {
  aspectFill: 'cover',
  aspectFit: 'contain',
  widthFix: 'contain'
}

const AppImage = {
  name: 'AppImage',
  inheritAttrs: false,
  props: {
    src: { type: String, required: true },
    alt: { type: String, default: '' },
    mode: { type: String, default: 'aspectFit' }
  },
  setup(props, { attrs }) {
    return () => {
      const isApp = typeof plus !== 'undefined'
      const tag = isApp ? 'image' : 'img'
      const elementProps = {
        ...attrs,
        src: props.src,
        style: isApp
          ? attrs.style
          : [attrs.style, { objectFit: objectFitByMode[props.mode] || 'contain' }]
      }
      if (isApp) elementProps.mode = props.mode
      else elementProps.alt = props.alt
      return h(tag, elementProps)
    }
  }
}

export default AppImage
