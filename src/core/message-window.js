// Both arrays are bounded by the repository. Older is descending; newer starts
// with the anchor and is ascending. Fill spare space at either end of a story.
export function selectAnchoredMessageWindow(older, newer, limit) {
  let olderCount = Math.min(older.length, Math.floor((limit - 1) / 2))
  const newerCount = Math.min(newer.length, limit - olderCount)
  olderCount = Math.min(older.length, limit - newerCount)
  return {
    messages: [...older.slice(0, olderCount).reverse(), ...newer.slice(0, newerCount)],
    hasMore: older.length > olderCount,
    hasNewer: newer.length > newerCount,
    anchorFound: true
  }
}
