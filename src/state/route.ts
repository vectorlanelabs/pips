// Path segment per game, used as /pips/<segment>. Engine + legacy alike.
export type RoutedGame = 'farkle' | 'yahtzee' | 'ttt' | 'hangman'
  | 'connect4' | 'rummy' | 'phase10' | 'battleship' | 'dominoes' | 'wahoo' | 'checkers' | 'mexican-train' | 'chess' | 'uno' | 'skipbo' | 'blackjack' | 'holdem' | 'solitaire' | 'scrabble'

export const GAME_SEGMENTS: Record<RoutedGame, string> = {
  farkle: 'farkle',
  yahtzee: 'yahtzee',
  ttt: 'ttt',
  hangman: 'hangman',
  connect4: 'connect4',
  rummy: 'rummy',
  phase10: 'phase10',
  battleship: 'battleship',
  dominoes: 'dominoes',
  wahoo: 'wahoo',
  checkers: 'checkers',
  'mexican-train': 'mexican-train',
  chess: 'chess',
  uno: 'uno',
  skipbo: 'skipbo',
  blackjack: 'blackjack',
  holdem: 'holdem',
  solitaire: 'solitaire',
  scrabble: 'scrabble',
}

const SEGMENT_SET = new Set<string>(Object.values(GAME_SEGMENTS))

function gameForSegment(segment: string): RoutedGame | null {
  return SEGMENT_SET.has(segment) ? (segment as RoutedGame) : null
}

export function gamePath(game: RoutedGame): string {
  return `/pips/${GAME_SEGMENTS[game]}`
}

// Tolerant: leading/trailing slashes, with or without the /pips base
// (GH Pages serves /pips/wahoo; dev may serve /wahoo after base strip —
// accept both), unknown segment -> null.
export function gameFromPath(pathname: string): RoutedGame | null {
  const segments = pathname.trim().split('/').filter((s) => s !== '')
  if (segments.length === 1) return gameForSegment(segments[0])
  if (segments.length === 2 && segments[0] === 'pips') return gameForSegment(segments[1])
  return null
}

export type BootAction =
  | { kind: 'shelf' }
  | { kind: 'join'; code: string }              // ?join=CODE (existing flow)
  | { kind: 'host'; game: RoutedGame }          // deep link with a name
  | { kind: 'shelf-needs-name'; game: RoutedGame } // deep link, no name

// Precedence: ?join= wins over the path; then game path (host if
// hasName else shelf-needs-name); else shelf.
export function decideBoot(pathname: string, search: string, hasName: boolean): BootAction {
  const joinCode = new URLSearchParams(search).get('join')
  if (joinCode !== null && joinCode !== '') return { kind: 'join', code: joinCode }
  const game = gameFromPath(pathname)
  if (game !== null) return hasName ? { kind: 'host', game } : { kind: 'shelf-needs-name', game }
  return { kind: 'shelf' }
}

// Cookie seam: the real browser uses document.cookie; tests inject a plain
// { cookie: string } object so the serialization can be exercised without a DOM.
export type CookieAccessor = { cookie: string }

const NAME_COOKIE = 'pips-name'

function defaultCookieAccessor(): CookieAccessor {
  return typeof document === 'undefined' ? { cookie: '' } : document
}

export function readNameCookie(accessor: CookieAccessor = defaultCookieAccessor()): string | null {
  const row = accessor.cookie.split('; ').find((entry) => entry.startsWith(`${NAME_COOKIE}=`))
  if (!row) return null
  const value = row.slice(NAME_COOKIE.length + 1).trim()
  if (value === '') return null
  return decodeURIComponent(value)
}

export function writeNameCookie(name: string, accessor: CookieAccessor = defaultCookieAccessor()): void {
  const trimmed = name.trim()
  if (trimmed === '') return
  // encodeURIComponent keeps names with ';', '=', spaces, or unicode from
  // breaking the cookie header or the split in readNameCookie.
  accessor.cookie = `${NAME_COOKIE}=${encodeURIComponent(trimmed)}; path=/; max-age=31536000; samesite=lax`
}

// The host's last-picked card back (a components/cardBacks.ts id). Same seam and
// lifetime as the name cookie; the caller validates the id against the registry.
const CARD_BACK_COOKIE = 'pips-card-back'

export function readCardBackCookie(accessor: CookieAccessor = defaultCookieAccessor()): string | null {
  const row = accessor.cookie.split('; ').find((entry) => entry.startsWith(`${CARD_BACK_COOKIE}=`))
  if (!row) return null
  const value = row.slice(CARD_BACK_COOKIE.length + 1).trim()
  return value === '' ? null : decodeURIComponent(value)
}

export function writeCardBackCookie(id: string, accessor: CookieAccessor = defaultCookieAccessor()): void {
  accessor.cookie = `${CARD_BACK_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`
}
