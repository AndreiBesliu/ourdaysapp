import React from 'react'

export default function Card({
  title,
  children,
  className,
  titleClassName
}: {
  title: string
  children: React.ReactNode
  className?: string
  titleClassName?: string
}) {
  return (
    <div className={`rounded-2xl shadow border bg-white overflow-hidden ${className || ''}`}>
      <div className={`text-xl font-bold p-3 text-center uppercase tracking-wide border-b border-black/5 ${titleClassName || ''}`}>
        {title}
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  )
}
