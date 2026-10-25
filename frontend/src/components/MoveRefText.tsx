import { useMemo } from 'react'
import { findMoveRefs, type MoveRef } from '../moveRefs'

interface MoveRefTextProps {
  text: string
  /** The game (UCI moves) as it stood when the text was written; without it, the text stays plain. */
  context?: string[]
  /** Show a move on the board (null: back to what it showed before). */
  onPreview: (move: MoveRef | null) => void
}

/** Text with the moves it mentions as links: pointing at one shows it on the board. */
export function MoveRefText({ text, context, onPreview }: MoveRefTextProps) {
  const segments = useMemo(() => (context ? findMoveRefs(text, context) : [text]), [text, context])
  return (
    <>
      {segments.map((segment, i) =>
        typeof segment === 'string' ? (
          segment
        ) : (
          <button
            key={i}
            type="button"
            className="move-ref"
            title={segment.label}
            onMouseEnter={() => onPreview(segment)}
            onMouseLeave={() => onPreview(null)}
            onFocus={() => onPreview(segment)}
            onBlur={() => onPreview(null)}
            onClick={() => onPreview(segment)}
          >
            {segment.text}
          </button>
        ),
      )}
    </>
  )
}
