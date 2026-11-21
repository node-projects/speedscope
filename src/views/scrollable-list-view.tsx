// Fixed-height rows render only the viewport and a quarter viewport of overscan.
// Geometry and scroll lookup use O(1) storage/work, independent of row count.
import {h, JSX} from 'preact'
import {useState, useCallback, useRef, useMemo, useEffect} from 'preact/hooks'
import {fixedSizeListRange} from '../lib/fixed-size-list'

interface ScrollableListViewProps {
  itemCount: number
  itemSize: number
  axis: 'x' | 'y'
  renderItems: (
    firstVisibleIndex: number,
    lastVisibleIndex: number,
  ) => JSX.Element | JSX.Element[] | null
  className?: string
  initialIndexInView?: number | null
}

export const ScrollableListView = ({
  itemCount,
  itemSize,
  axis,
  renderItems,
  className,
  initialIndexInView,
}: ScrollableListViewProps) => {
  const [viewportSize, setViewportSize] = useState<number | null>(null)
  const [viewportScrollOffset, setViewportScrollOffset] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const initialScroll = useRef(
    Math.max(0, Math.min(initialIndexInView || 0, Math.max(0, itemCount - 1))) * itemSize,
  )
  const initialized = useRef(false)
  const vertical = axis === 'y'
  const totalSize = itemCount * itemSize
  const onViewportScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport) setViewportScrollOffset(vertical ? viewport.scrollTop : viewport.scrollLeft)
  }, [vertical])

  useEffect(() => {
    const viewport = viewportRef.current!
    const measure = () => {
      const size = viewport.getBoundingClientRect()[vertical ? 'height' : 'width']
      setViewportSize(size)
      if (!initialized.current) {
        initialized.current = true
        if (vertical) viewport.scrollTop = initialScroll.current
        else viewport.scrollLeft = initialScroll.current
      }
      // Filtering or resizing can shrink the scroll extent. Synchronize the
      // stored offset even if the browser does not emit scroll on clamping.
      const offset = vertical ? viewport.scrollTop : viewport.scrollLeft
      const clamped = Math.max(0, Math.min(offset, Math.max(0, totalSize - size)))
      if (vertical) viewport.scrollTop = clamped
      else viewport.scrollLeft = clamped
      setViewportScrollOffset(clamped)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(viewport)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [vertical, totalSize])

  const range = useMemo(
    () =>
      viewportSize == null
        ? null
        : fixedSizeListRange(itemCount, itemSize, viewportSize, viewportScrollOffset),
    [itemCount, itemSize, viewportSize, viewportScrollOffset],
  )
  const visibleItems = useMemo(
    () => (range ? renderItems(range.firstVisibleIndex, range.lastVisibleIndex) : null),
    [renderItems, range],
  )
  return (
    <div className={className} ref={viewportRef} onScroll={onViewportScroll}>
      <div style={vertical ? {height: totalSize} : {width: totalSize}}>
        <div
          style={{
            transform: `translate${vertical ? 'Y' : 'X'}(${range?.invisiblePrefixSize || 0}px)`,
          }}
        >
          {visibleItems}
        </div>
      </div>
    </div>
  )
}
