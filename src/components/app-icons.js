import { h } from 'vue'

const ICONS = {
  Activity: { glyph: '\ue657' },
  AlertCircle: { glyph: '\ue649' },
  ArrowLeft: { glyph: '\ue6bc' },
  Camera: { glyph: '\ue65a' },
  Check: { glyph: '\ue65c' },
  CheckCheck: { glyph: '\ue65c' },
  ChevronDown: { glyph: '\ue6b8' },
  ChevronRight: { glyph: '\ue6b5' },
  CircleHelp: { glyph: '\ue679' },
  ClipboardCopy: { glyph: '\ue67f' },
  Cloud: { glyph: '\ue645' },
  Copy: { glyph: '\ue67f' },
  Database: { glyph: '\ue644' },
  Download: { glyph: '\ue68d' },
  EyeOff: { glyph: '\ue6b3' },
  FileCog: { glyph: '\ue6aa' },
  FileText: { glyph: '\ue67f' },
  History: { glyph: '\ue633' },
  Image: { glyph: '\ue670' },
  Import: { glyph: '\ue68d' },
  Info: { glyph: '\ue669' },
  KeyRound: { glyph: '\ue668' },
  LockKeyhole: { glyph: '\ue66b' },
  Menu: { glyph: '\ue627' },
  MessageCircle: { glyph: '\ue697' },
  Mic: { glyph: '\ue671' },
  MoreVertical: { glyph: '\ue64e' },
  Paperclip: { glyph: '\ue652' },
  Contact: { glyph: '\ue693' },
  Person: { glyph: '\ue699' },
  PersonAdd: { glyph: '\ue69f' },
  Play: { glyph: '\u25b6', system: true },
  PlayOutline: { glyph: '\u25b7', system: true },
  Plus: { glyph: '\ue67b' },
  RefreshCw: { glyph: '\ue657' },
  RotateCcw: { glyph: '\ue64f' },
  Search: { glyph: '\ue654' },
  Send: { glyph: '\ue672' },
  Server: { glyph: '\ue644' },
  Settings: { glyph: '\ue653' },
  Square: { glyph: '\u25a0', system: true },
  ThumbsDown: { glyph: '\ue63d' },
  ThumbsUp: { glyph: '\ue63f' },
  Tune: { glyph: '\ue6aa' },
  Trash2: { glyph: '\ue687' },
  Upload: { glyph: '\ue690' },
  X: { glyph: '\ue66c' }
}

function iconSize(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? `${parsed}px` : String(value || '16px')
}

function createIcon(name) {
  const definition = ICONS[name]
  return {
    name,
    inheritAttrs: false,
    props: {
      size: { type: [Number, String], default: 16 },
      color: { type: String, default: '' },
      fill: { type: String, default: '' },
      strokeWidth: { type: [Number, String], default: 2 }
    },
    setup(props, { attrs }) {
      return () => {
        const size = iconSize(props.size)
        return h('text', {
          ...attrs,
          'aria-hidden': 'true',
          class: ['app-icon', attrs.class],
          style: [attrs.style, {
            color: props.color || 'currentColor',
            fontFamily: definition.system ? 'Arial, sans-serif' : 'AIChatIcons',
            fontSize: size,
            height: size,
            lineHeight: size,
            width: size
          }]
        }, definition.glyph)
      }
    }
  }
}

export const Activity = createIcon('Activity')
export const AlertCircle = createIcon('AlertCircle')
export const ArrowLeft = createIcon('ArrowLeft')
export const Camera = createIcon('Camera')
export const Check = createIcon('Check')
export const CheckCheck = createIcon('CheckCheck')
export const ChevronDown = createIcon('ChevronDown')
export const ChevronRight = createIcon('ChevronRight')
export const CircleHelp = createIcon('CircleHelp')
export const ClipboardCopy = createIcon('ClipboardCopy')
export const Cloud = createIcon('Cloud')
export const Copy = createIcon('Copy')
export const Database = createIcon('Database')
export const Download = createIcon('Download')
export const EyeOff = createIcon('EyeOff')
export const FileCog = createIcon('FileCog')
export const FileText = createIcon('FileText')
export const History = createIcon('History')
export const Image = createIcon('Image')
export const Import = createIcon('Import')
export const Info = createIcon('Info')
export const KeyRound = createIcon('KeyRound')
export const LockKeyhole = createIcon('LockKeyhole')
export const Menu = createIcon('Menu')
export const MessageCircle = createIcon('MessageCircle')
export const Mic = createIcon('Mic')
export const MoreVertical = createIcon('MoreVertical')
export const Paperclip = createIcon('Paperclip')
export const Contact = createIcon('Contact')
export const Person = createIcon('Person')
export const PersonAdd = createIcon('PersonAdd')
export const Play = createIcon('Play')
export const PlayOutline = createIcon('PlayOutline')
export const Plus = createIcon('Plus')
export const RefreshCw = createIcon('RefreshCw')
export const RotateCcw = createIcon('RotateCcw')
export const Search = createIcon('Search')
export const Send = createIcon('Send')
export const Server = createIcon('Server')
export const Settings = createIcon('Settings')
export const Square = createIcon('Square')
export const ThumbsDown = createIcon('ThumbsDown')
export const ThumbsUp = createIcon('ThumbsUp')
export const Tune = createIcon('Tune')
export const Trash2 = createIcon('Trash2')
export const Upload = createIcon('Upload')
export const X = createIcon('X')
