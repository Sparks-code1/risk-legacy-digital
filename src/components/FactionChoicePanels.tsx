/**
 * The faction and ability choice panels, shared between the hotseat setup
 * screen and the online setup screen.
 *
 * Extracted from GameSetupScreen so the two cannot drift: what a faction card
 * shows — its lead-faction banner, its campaign marks, its locked-in ability —
 * is part of the GAME, and a player choosing online must be reading exactly
 * what a player choosing at the table reads.
 */
import { FACTION_COLORS } from '@/data/mockGameState'
import { FACTION_ABILITY_OPTIONS, getAbilitiesForFaction, getAbility } from '@/data/factionAbilities'
import { leadFactionId, factionWinCounts } from '@/lib/gameLogic'
import { factionCampaignMarks } from '@/lib/factionPowers'
import type { FactionId } from '@/types/faction'
import type { LegacyState } from '@/types/legacy'

export const FACTION_NAMES: Record<string, string> = {
  'enclave-of-the-bear': 'Enclave of the Bear',
  'imperial-balkania':   'Imperial Balkania',
  'khan-industries':     'Khan Industries',
  'saharan-republic':    'Saharan Republic',
  'die-mechaniker':      'Die Mechaniker',
  'aliens':              'Aliens',
  'mutants':             'Mutants',
}

const BASE_FACTIONS = ['enclave-of-the-bear', 'imperial-balkania', 'khan-industries', 'saharan-republic', 'die-mechaniker']

/** Milestone factions become selectable once their milestone has fired. */
export function availableFactions(legacy: LegacyState | null | undefined): string[] {
  return [
    ...BASE_FACTIONS,
    ...(legacy?.alienMilestoneTriggered ? ['aliens'] : []),
    ...(legacy?.nuclearMilestoneTriggered ? ['mutants'] : []),
  ]
}

export const PHASE_LABEL: Record<string, string> = {
  combat: '⚔ Combat',
  draft: '⊕ Draft',
  fortify: '⟳ Fortify',
  any: '★ Any Phase',
}

export function hexToRgb(hex: number): string {
  return `rgb(${(hex >> 16) & 0xff},${(hex >> 8) & 0xff},${hex & 0xff})`
}

export function factionRgb(factionId: string | null | undefined): string {
  return factionId ? hexToRgb(FACTION_COLORS[factionId] ?? 0x888888) : 'rgb(200,148,10)'
}

/** The faction's colour for its NAME, by id — [factionNameColour] with the lookup done. */
export function factionNameRgb(factionId: string | null | undefined): string {
  return factionId ? factionNameColour(FACTION_COLORS[factionId] ?? 0x888888) : 'rgb(200,148,10)'
}

/**
 * The rim every faction swatch wears, so the two near-black factions' dots
 * show against a near-black row. Faint enough to be nothing on a bright colour.
 */
export const SWATCH_RIM = '1px solid rgba(232,220,200,0.45)'

/**
 * The faction's own colour for its NAME — unless that colour would vanish.
 *
 * The screens are near-black, and two factions are too: the Saharan Republic
 * is 0x1a1a1a and the Mutants 0x8b0000. Painting their names in their own
 * colour made them unreadable, and made "available" indistinguishable from
 * "taken" — a picked Saharan card and an unpicked one were both a dark smudge
 * with a dark dot, and the only difference was a 0.45 opacity nobody can see
 * on black. Relative luminance below 60 (of 255) hands the name the screen's
 * text colour instead; every other faction is at 91 or above and keeps its own.
 * The swatch beside it keeps the true colour, with a light rim so a black dot
 * still reads as a black dot.
 */
export function factionNameColour(hex: number): string {
  const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance < 60 ? '#E8DCC8' : hexToRgb(hex)
}

/**
 * The faction's colour for EDGES — card borders, row borders — at the alpha
 * asked for, unless that colour would vanish; then a light rim instead.
 *
 * The name rule above fixed the name and left the rest of the card painted in
 * the same near-black: the border and the two ability rows inside it. Beside
 * every other faction's coloured border and coloured rows, a Saharan card with
 * an invisible border and unreadable rows read as the DIMMED one — which is
 * what "taken" used to look like, so an available Saharan looked taken.
 */
export function factionEdgeColour(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance < 60
    ? `rgba(232,220,200,${Math.min(0.6, alpha).toFixed(2)})`
    : `rgba(${r},${g},${b},${alpha})`
}

// ─── The faction card list ───────────────────────────────────────────────────

interface FactionListProps {
  legacy: LegacyState | null
  existingAbilities: Record<string, string>
  removedAbilityIds: string[]
  takenFactionIds: string[]
  /** Shown in the section header: whose pick this is. */
  pickerName: string
  onPick: (factionId: string) => void
  /** False renders the list read-only — a spectator watching someone pick. */
  canPick?: boolean
}

export function FactionChoiceList({
  legacy, existingAbilities, removedAbilityIds, takenFactionIds, pickerName, onPick, canPick = true,
}: FactionListProps) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#6a5030', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, borderBottom: '1px solid rgba(200,148,10,0.15)', paddingBottom: 5 }}>
        {pickerName} — Pick a Faction
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {availableFactions(legacy).map(fid => {
          const taken = takenFactionIds.includes(fid)
          const disabled = taken || !canPick
          const hex = FACTION_COLORS[fid as FactionId] ?? 0x888888
          const col = hexToRgb(hex)
          const [ab1, ab2] = getAbilitiesForFaction(fid as FactionId)
          // A faction that locked its ability in during an earlier game never
          // chooses again — show the settled power rather than two options it
          // can no longer pick between.
          const lockedAbility = existingAbilities[fid] ? getAbility(existingAbilities[fid]) : undefined
          const visibleAbilities = lockedAbility
            ? [lockedAbility]
            : [ab1, ab2].filter(ab => ab && !removedAbilityIds.includes(ab.id))
          return (
            <button
              key={fid}
              onClick={() => !disabled && onPick(fid)}
              disabled={disabled}
              style={{
                padding: '10px 14px', borderRadius: 9, textAlign: 'left',
                // SOLID, FOR EVERY CARD. The old card was a faction-tinted
                // translucency over a near-black screen, which for a dark
                // faction was nothing at all — and its "taken" state was the
                // same nothing at 0.45 opacity. Taken and available looked
                // identical for exactly the factions where it mattered. The
                // surface is one colour now, the border is the faction's at
                // full strength when available and a muted neutral when not,
                // and the taken cue is STRUCTURAL — see the name row.
                background: '#150c04',
                border: `1.5px solid ${taken
                  ? 'rgba(140,110,70,0.30)'
                  : factionEdgeColour(hex, 0.85)}`,
                color: taken ? '#7a6a58' : '#E8DCC8',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontFamily: 'Georgia, serif',
              }}
            >
              {/* Faction name row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                {/* TAKEN IS A SHAPE, NOT A SHADE. A filled swatch is available;
                    a hollow ring is taken, and the name is struck through. None
                    of it depends on how bright the faction's colour is, which is
                    the whole point: for the Saharan Republic and the Mutants a
                    dimmer black is still black. No label: the ring and the
                    strike say it. */}
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  background: taken ? 'transparent' : col,
                  border: taken
                    ? '1.5px solid rgba(160,140,110,0.60)'
                    : SWATCH_RIM,
                }} />
                <span style={{
                  fontSize: 13, fontWeight: 'bold',
                  color: taken ? '#8a7a68' : factionNameColour(FACTION_COLORS[fid as FactionId] ?? 0x888888),
                  textDecoration: taken ? 'line-through' : 'none',
                }}>{FACTION_NAMES[fid]}</span>
              </div>
              {/* Lead faction — most campaign wins. Owns the World Capital
                  at game start and picks the face-up mission. */}
              {leadFactionId(legacy?.victoryLog) === fid && (
                <div style={{
                  padding: '6px 8px', borderRadius: 6, marginBottom: 7,
                  background: taken ? 'rgba(0,0,0,0.15)' : 'rgba(212,175,55,0.12)',
                  border: `1px solid ${taken ? 'rgba(100,75,25,0.10)' : 'rgba(212,175,55,0.55)'}`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 'bold', color: taken ? '#4a3020' : '#D4AF37', marginBottom: 2 }}>
                    ⌃ Lead Faction · {factionWinCounts(legacy?.victoryLog)[fid] ?? 0} wins
                  </div>
                  <div style={{ fontSize: 9, color: taken ? '#3a2010' : '#9a8060', lineHeight: 1.4 }}>
                    {legacy?.worldCapitalTerritoryId
                      ? 'Picks the starting face-up mission and begins owning the World Capital with 3 troops.'
                      : 'Lead-faction rules activate once the World Capital is placed.'}
                  </div>
                </div>
              )}
              {/* Everything this faction carries in from past games — star
                  power, comeback powers, weaknesses, the nuclear mark. */}
              {factionCampaignMarks(fid, legacy).map((pw, i) => (
                <div key={i} style={{
                  padding: '6px 8px', borderRadius: 6, marginBottom: 7,
                  background: taken ? 'rgba(0,0,0,0.15)' : `${pw.color}1A`,
                  border: `1px solid ${taken ? 'rgba(100,75,25,0.10)' : `${pw.color}73`}`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 'bold', color: taken ? '#4a3020' : pw.color, marginBottom: 2 }}>
                    {pw.label}{pw.name ? ` · ${pw.name}` : ''}
                  </div>
                  <div style={{ fontSize: 9, color: taken ? '#3a2010' : '#9a8060', lineHeight: 1.4 }}>
                    {pw.description}
                  </div>
                </div>
              ))}
              {/* The ability: two options to choose from, or the one already
                  locked in for the rest of the campaign. */}
              <div style={{ display: 'flex', gap: 8 }}>
                {visibleAbilities.map(ab => ab && (
                  <div key={ab.id} style={{
                    flex: 1, padding: '6px 8px', borderRadius: 6,
                    background: taken ? 'rgba(0,0,0,0.15)' : col.replace('rgb', 'rgba').replace(')', ',0.08)'),
                    // The row's border and title follow the same rule as the
                    // card's border and the faction's name: the faction colour
                    // unless it would vanish. These two rows were what made an
                    // available Saharan card read as the dimmed one.
                    border: `1px solid ${taken ? 'rgba(100,75,25,0.10)' : factionEdgeColour(hex, 0.22)}`,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 'bold', color: taken ? '#4a3020' : factionNameColour(hex), marginBottom: 2 }}>
                      {PHASE_LABEL[ab.phase] ?? ab.phase} · {ab.name}
                      {lockedAbility && (
                        <span style={{ marginLeft: 6, fontWeight: 'normal', fontSize: 9, color: taken ? '#4a3020' : '#7a6848' }}>
                          🔒 locked in
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: taken ? '#3a2010' : '#9a8060', lineHeight: 1.4 }}>
                      {ab.tagline}
                    </div>
                  </div>
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── The two-option ability choice ───────────────────────────────────────────

interface AbilityChoiceProps {
  factionId: string
  pickerName: string
  onPick: (abilityId: string) => void
  canPick?: boolean
}

export function AbilityChoicePair({ factionId, pickerName, onPick, canPick = true }: AbilityChoiceProps) {
  const [opt1, opt2] = getAbilitiesForFaction(factionId as FactionId)
  if (!opt1 || !opt2) return null
  const col = factionRgb(factionId)
  // The faction's colour for its NAME, unless that colour would vanish — the
  // same rule the faction list applies, for the same two near-black factions.
  const hex = FACTION_COLORS[factionId as FactionId] ?? 0x888888
  const nameCol = factionNameColour(hex)
  return (
    <div>
      <div style={{ fontSize: 10, color: '#6a5030', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14, borderBottom: '1px solid rgba(200,148,10,0.15)', paddingBottom: 5 }}>
        <span style={{ color: nameCol }}>{pickerName}</span>
        {' '}({FACTION_NAMES[factionId]}) — Choose Permanent Ability
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        {[opt1, opt2].map(opt => (
          <button
            key={opt.id}
            onClick={() => canPick && onPick(opt.id)}
            disabled={!canPick}
            style={{
              flex: 1, padding: '16px 14px', borderRadius: 10, textAlign: 'left',
              // SOLID, like the faction cards. A faction-tinted translucency at
              // 6% over a near-black screen was invisible for a dark faction,
              // and its two options read as two disabled panels. One surface,
              // and a border in the faction's colour at full strength.
              background: '#150c04',
              border: `1.5px solid ${factionEdgeColour(hex, 0.85)}`,
              color: '#E8DCC8', cursor: canPick ? 'pointer' : 'not-allowed', fontFamily: 'Georgia, serif',
            }}
            onMouseEnter={e => {
              if (!canPick) return
              e.currentTarget.style.background = '#1e1208'
              e.currentTarget.style.borderColor = factionEdgeColour(hex, 1)
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#150c04'
              e.currentTarget.style.borderColor = factionEdgeColour(hex, 0.85)
            }}
          >
            <div style={{
              display: 'inline-block', fontSize: 9, padding: '2px 8px', borderRadius: 8,
              background: col.replace('rgb', 'rgba').replace(')', ',0.12)'),
              border: `1px solid ${factionEdgeColour(hex, 0.35)}`,
              color: nameCol, letterSpacing: 0.5, marginBottom: 10,
            }}>
              {PHASE_LABEL[opt.phase] ?? opt.phase}
            </div>
            <div style={{ fontSize: 15, fontWeight: 'bold', color: nameCol, marginBottom: 6, lineHeight: 1.2 }}>
              {opt.name}
            </div>
            <div style={{ fontSize: 11, color: '#C8940A', marginBottom: 8, fontStyle: 'italic' }}>
              {opt.tagline}
            </div>
            <div style={{ fontSize: 11, color: '#8a7060', lineHeight: 1.5 }}>
              {opt.description}
            </div>
            {canPick && (
              <div style={{ marginTop: 12, fontSize: 10, color: factionEdgeColour(hex, 0.55), textAlign: 'center' }}>
                Click to choose →
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Names shown beside picks in order summaries. */
export function abilityName(abilityId: string | undefined): string | undefined {
  return abilityId ? FACTION_ABILITY_OPTIONS.find(a => a.id === abilityId)?.name : undefined
}
