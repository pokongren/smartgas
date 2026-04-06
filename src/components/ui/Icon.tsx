/**
 * Icon 组件 - 统一封装 Material Symbols Outlined 图标
 * 用法：<Icon name="home" />  <Icon name="close" size={20} color="#ef4444" />
 *
 * NOTE: 图标字体通过 index.html 内联的 @font-face 加载（public/fonts/material-symbols-outlined.woff2）
 * 完全本地化，不依赖任何 CDN，离线也能用。
 */
import React from 'react'

interface IconProps {
  /** Material Symbols 图标名称，如 "home", "close", "sensors" */
  name: string
  /** 图标大小（px），默认跟随父元素 font-size */
  size?: number | string
  /** 图标颜色，默认继承父元素 */
  color?: string
  /** 额外的 className */
  className?: string
  /** 内联样式 */
  style?: React.CSSProperties
  /** 填充模式：0 = 线框（默认），1 = 填充 */
  fill?: 0 | 1
  /** 字重：100~700，默认 400 */
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700
}

const Icon: React.FC<IconProps> = ({
  name,
  size,
  color,
  className = '',
  style,
  fill = 0,
  weight = 400,
}) => {
  const fontVariation = `"FILL" ${fill}, "wght" ${weight}, "GRAD" 0, "opsz" 24`

  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{
        ...(size !== undefined ? { fontSize: typeof size === 'number' ? `${size}px` : size } : {}),
        ...(color !== undefined ? { color } : {}),
        fontVariationSettings: fontVariation,
        ...style,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}

export default Icon
