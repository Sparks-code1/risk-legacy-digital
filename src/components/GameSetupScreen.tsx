import { useEffect, useState } from 'react'
import { MOCK_PLAYERS, FACTION_COLORS } from '@/data/mockGameState'
import { TERRITORY_DEFINITIONS } from '@/data/territoryData'
import { getAbilitiesForFaction } from '@/data/factionAbilities'
import { needsWeaknessPower, WEAKNESS_POWERS } from '@/data/weaknessPowers'
import type { FactionId } from '@/types/faction'
import type { LegacyState } from '@/types/legacy'
import type { AIDifficulty } from '@/types/ai'
import { aiSetupChoice } from '@/lib/ai'
import HQMapPicker from './HQMapPicker'
import WeaknessPowerPicker from './WeaknessPowerPicker'
import {
  FactionChoiceList, AbilityChoicePair, FACTION_NAMES, hexToRgb, abilityName,
  availableFactions, factionNameRgb, SWATCH_RIM,
} from './FactionChoicePanels'

export interface PlayerSetup {
  playerId: string
  name: string
  factionId: string
  startingTerritoryId: string
  /** Drafted starting troops (improved draft) — defaults to 8 when absent */
  startingTroops?: number
  /** Drafted starting coin cards (improved draft) — dealt from the resource deck */
  startingCoins?: number
  /** True when this slot is played by the computer */
  isAI?: boolean
  /** AI difficulty for this slot (only when isAI) */
  aiDifficulty?: AIDifficulty
}

interface Props {
  playerOrder: string[]
  /** Abilities already locked in from a prior game (factionId → abilityId). Empty on game 1. */
  existingAbilities: Record<string, string>
  /** Ability IDs permanently removed (the unchosen options from prior games). */
  removedAbilityIds?: string[]
  /** Full legacy state for map overlays (cities, scars). Null on game 1. */
  legacy?: LegacyState | null
  /** Players driven by the computer. They answer every question below. */
  aiPlayerIds?: Set<string>
  /**
   * How hard each computer seat plays, by player id.
   *
   * SEPARATE FROM THE SET ABOVE rather than folded into it, because the set
   * is what the weakness auto-claim has always read and two screens pass it.
   * A seat in the set with no entry here plays at medium, which is the
   * default the slots screen offers.
   */
  aiDifficulty?: Record<string, AIDifficulty>
  onSetupComplete: (
    setups: PlayerSetup[],
    order: string[],
    abilityChoices: Record<string, string>,
    weaknessChoices: Record<string, string>,
  ) => void
}

/**
 * How long a computer seat sits with a question before answering it.
 *
 * Not a fake think — the choice is instant. It is the time a player needs to
 * read which faction and which ability the bot took, on a screen that would
 * otherwise flick through three of them between frames.
 */
const AI_CHOICE_MS = 650

type Phase = 'faction' | 'weakness' | 'ability' | 'territory'

export default function GameSetupScreen({ playerOrder, existingAbilities, removedAbilityIds = [], legacy = null, aiPlayerIds, aiDifficulty = {}, onSetupComplete }: Props) {
  const players = playerOrder.map(id => MOCK_PLAYERS.find(p => p.id === id)!)
  const [phase, setPhase] = useState<Phase>('faction')
  const [factionPicks, setFactionPicks]   = useState<Record<string, string>>({})  // playerId → factionId
  const [abilityPicks, setAbilityPicks]   = useState<Record<string, string>>({})  // factionId → abilityId
  const [weaknessPicks, setWeaknessPicks] = useState<Record<string, string>>({})  // factionId → weakness powerId
  const [territoryPicks, setTerritoryPicks] = useState<Record<string, string>>({}) // playerId → territoryId
  const [currentIdx, setCurrentIdx] = useState(0)

  const currentPlayer = players[currentIdx] ?? null
  const takenFactions = Object.values(factionPicks)

  // ── Faction phase ───────────────────────────────────────────────────────────

  function advanceAfterFactionStage(nextPicks: Record<string, string>) {
    if (currentIdx < players.length - 1) {
      setCurrentIdx(i => i + 1)
      setPhase('faction')
    } else {
      // All factions chosen — move to ability phase (skip if all abilities pre-existing;
      // milestone factions like Aliens/Mutants have no ability options and are skipped)
      const firstNeedIdx = players.findIndex(p => {
        const fid = nextPicks[p.id]
        return fid && !existingAbilities[fid] && !!getAbilitiesForFaction(fid as FactionId)[0]
      })
      setCurrentIdx(firstNeedIdx >= 0 ? firstNeedIdx : 0)
      setPhase(firstNeedIdx >= 0 ? 'ability' : 'territory')
    }
  }

  function handleFactionPick(factionId: string) {
    if (!currentPlayer) return
    const next = { ...factionPicks, [currentPlayer.id]: factionId }
    setFactionPicks(next)
    if (needsWeaknessPower(factionId, legacy)) {
      if (aiPlayerIds?.has(currentPlayer.id)) {
        // The computer accepts the first unclaimed weakness — no picker opens.
        const taken = new Set([...Object.values(weaknessPicks), ...Object.values(legacy?.alienWeaknessPowers ?? {})])
        const pick = WEAKNESS_POWERS.find(p => !taken.has(p.id))
        if (pick) setWeaknessPicks(prev => ({ ...prev, [factionId]: pick.id }))
        advanceAfterFactionStage(next)
      } else {
        // Same player immediately picks their weakness power before the draft advances
        setPhase('weakness')
      }
    } else {
      advanceAfterFactionStage(next)
    }
  }

  // ── Weakness power phase (alien milestone) ─────────────────────────────────

  function handleWeaknessPick(powerId: string) {
    if (!currentPlayer) return
    const fid = factionPicks[currentPlayer.id]
    if (fid) setWeaknessPicks(prev => ({ ...prev, [fid]: powerId }))
    advanceAfterFactionStage(factionPicks)
  }

  // ── Ability phase ───────────────────────────────────────────────────────────

  function handleAbilityPick(factionId: string, abilityId: string) {
    const next = { ...abilityPicks, [factionId]: abilityId }
    setAbilityPicks(next)
    // Advance to next player who still needs to pick (skip factions with no ability options)
    let nextIdx = currentIdx + 1
    while (nextIdx < players.length) {
      const fid = factionPicks[players[nextIdx].id]
      if (fid && !existingAbilities[fid] && !next[fid] && !!getAbilitiesForFaction(fid as FactionId)[0]) break
      nextIdx++
    }
    if (nextIdx < players.length) {
      setCurrentIdx(nextIdx)
    } else {
      setCurrentIdx(0)
      setPhase('territory')
    }
  }

  // ── The computer answers for itself ─────────────────────────────────────────

  /**
   * Whether the seat being asked right now is played by the computer, and how
   * hard. Null for a human, and null while nobody is being asked.
   */
  const askingAI: AIDifficulty | null =
    currentPlayer && aiPlayerIds?.has(currentPlayer.id)
      ? aiDifficulty[currentPlayer.id] ?? 'medium'
      : null

  /**
   * The faction and the permanent ability, taken by the bot whose turn it is.
   *
   * IT USED TO BE THE HUMAN WHO ANSWERED THESE. This screen took an
   * `aiPlayerIds` set and consulted it in exactly one place — the alien
   * weakness power — so a solo player picked their opponents' factions, their
   * opponents' permanent abilities and their opponents' starting ground, one
   * seat at a time, before a game they were about to play against them. The
   * board driver has always run the AI's whole turn. Setup was the odd one out.
   *
   * THROUGH THE SAME HANDLERS A CLICK CALLS, so everything that hangs off a
   * pick still happens: the alien weakness auto-claim below handleFactionPick,
   * the ability phase skipping factions that have none, the advance to the next
   * seat. A branch that set the state directly would be a second copy of the
   * sequencing, and it would be the copy that missed the next rule added.
   *
   * AFTER A BEAT, because a human has to see what was taken — three factions
   * claimed in one frame is not a screen anybody can read. The card names the
   * picker, so the pause is the bot showing its choice.
   *
   * THE TERRITORY IS NOT HERE. That one lives in HQMapPicker, which is the only
   * thing that knows which ground is legal — see its `autoPick`.
   */
  useEffect(() => {
    if (!askingAI || !currentPlayer) return
    if (phase !== 'faction' && phase !== 'ability') return

    const wait = setTimeout(() => {
      if (phase === 'faction') {
        const open = availableFactions(legacy).filter(f => !takenFactions.includes(f))
        const want = aiSetupChoice(open, askingAI)
        if (want) handleFactionPick(want)
        return
      }
      const fid = factionPicks[currentPlayer.id]
      if (!fid) return
      const want = aiSetupChoice(
        getAbilitiesForFaction(fid as FactionId)
          .filter(a => !removedAbilityIds.includes(a.id))
          .map(a => a.id),
        askingAI)
      if (want) handleAbilityPick(fid, want)
    }, AI_CHOICE_MS)
    return () => clearTimeout(wait)
    // The seat and the question. Not the handlers — they close over state that
    // changes every render, and depending on them would re-arm the timer
    // continuously and pick again the moment it fired.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askingAI, currentPlayer?.id, phase])

  // ── Territory phase ─────────────────────────────────────────────────────────

  function handleTerritoryPick(territoryId: string) {
    if (!currentPlayer) return
    const next = { ...territoryPicks, [currentPlayer.id]: territoryId }
    setTerritoryPicks(next)
    if (currentIdx < players.length - 1) {
      setCurrentIdx(i => i + 1)
    } else {
      const setups: PlayerSetup[] = playerOrder.map(id => {
        const p = players.find(pl => pl.id === id)!
        return {
          playerId: id,
          name: p.name,
          factionId: factionPicks[id] ?? 'enclave-of-the-bear',
          startingTerritoryId: (id === currentPlayer.id ? territoryId : territoryPicks[id]) ?? '',
        }
      })
      const allAbilities = { ...existingAbilities, ...abilityPicks }
      onSetupComplete(setups, playerOrder, allAbilities, weaknessPicks)
    }
  }

  // ── Derived for current phase ───────────────────────────────────────────────

  const currentFactionId = currentPlayer ? factionPicks[currentPlayer.id] : null

  const phaseTitle = phase === 'faction' ? '⚑ CHOOSE YOUR FACTION'
    : phase === 'weakness' ? '⚠ CHOOSE YOUR WEAKNESS POWER'
    : phase === 'ability' ? '★ CHOOSE YOUR FACTION ABILITY'
    : '♛ PLACE YOUR HQ'

  const phaseSubtitle = phase === 'faction'
    ? 'In turn order, each player picks their faction'
    : phase === 'weakness'
    ? 'The alien invasion has weakened humanity — each faction must accept a permanent weakness'
    : phase === 'ability'
    ? 'Each faction chooses one permanent ability for the entire campaign'
    : 'In turn order, each player claims a starting territory (HQ + 8 troops)'

  // Territory phase gets a wide fullscreen layout with the map; other phases use the card layout
  if (phase === 'territory') {
    const factionColor = currentPlayer ? `rgb(${[(FACTION_COLORS[factionPicks[currentPlayer.id] ?? ''] ?? 0x888888) >> 16 & 0xff, (FACTION_COLORS[factionPicks[currentPlayer.id] ?? ''] ?? 0x888888) >> 8 & 0xff, (FACTION_COLORS[factionPicks[currentPlayer.id] ?? ''] ?? 0x888888) & 0xff].join(',')})` : '#C8940A'
    const placedHQs = Object.entries(territoryPicks).map(([pid, tid]) => {
      const p = players.find(pl => pl.id === pid)!
      return { playerId: pid, playerName: p.name, factionId: factionPicks[pid] ?? '', territoryId: tid }
    })

    return (
      <div style={{
        width: '100vw', height: '100vh',
        background: 'radial-gradient(ellipse at center, #1A0E04 0%, #080400 100%)',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Georgia, serif', padding: '12px 16px', boxSizing: 'border-box',
        gap: 10,
      }}>
        {/* Title bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#C8940A', letterSpacing: 1.5 }}>♛ PLACE YOUR HQ</div>
            <div style={{ fontSize: 11, color: '#7a6040', marginTop: 2 }}>
              In turn order, each player claims a starting territory — HQ + 8 troops
            </div>
          </div>
          {/* Current player callout */}
          {currentPlayer && (
            <div style={{
              marginLeft: 'auto', padding: '6px 16px', borderRadius: 8,
              background: `${factionColor.replace('rgb', 'rgba').replace(')', ',0.12)')}`,
              border: `1.5px solid ${factionColor.replace('rgb', 'rgba').replace(')', ',0.55)')}`,
              fontSize: 13, color: '#E8DCC8',
            }}>
              <span style={{ color: factionColor, fontWeight: 'bold' }}>{currentPlayer.name}</span>
              <span style={{ fontSize: 10, color: '#7a6040', marginLeft: 8 }}>is choosing…</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
          {/* Sidebar: player order summary */}
          <div style={{
            width: 180, flexShrink: 0,
            background: 'linear-gradient(155deg, #1A0E02 0%, #0A0600 100%)',
            border: '1.5px solid rgba(200,148,10,0.30)',
            borderRadius: 10, padding: '12px 10px',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ fontSize: 9, color: '#5a4020', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Turn Order</div>
            {players.map((p, idx) => {
              const fid = factionPicks[p.id]
              const tid = territoryPicks[p.id]
              const tName = tid ? (TERRITORY_DEFINITIONS.find(d => d.id === tid)?.name ?? tid) : null
              const col = fid ? `rgb(${[(FACTION_COLORS[fid] ?? 0x888888) >> 16 & 0xff, (FACTION_COLORS[fid] ?? 0x888888) >> 8 & 0xff, (FACTION_COLORS[fid] ?? 0x888888) & 0xff].join(',')})` : 'rgb(100,80,50)'
              const isActive = idx === currentIdx
              const isDone = tName !== null
              return (
                <div key={p.id} style={{
                  padding: '7px 9px', borderRadius: 7,
                  background: isActive ? 'rgba(200,148,10,0.08)' : 'rgba(0,0,0,0.25)',
                  border: `1px solid ${isActive ? 'rgba(200,148,10,0.50)' : 'rgba(100,75,25,0.14)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: isDone ? col : (isActive ? col : '#3a2810'), border: SWATCH_RIM, flexShrink: 0 }} />
                    <div style={{ fontSize: 12, color: isActive ? '#E8DCC8' : (isDone ? '#9a8060' : '#4a3820'), fontWeight: isActive ? 'bold' : 'normal' }}>
                      {p.name}
                    </div>
                  </div>
                  {isDone && tName && (
                    <div style={{ fontSize: 10, color: '#27AE60', marginTop: 3, marginLeft: 16 }}>♛ {tName}</div>
                  )}
                  {isActive && !isDone && (
                    <div style={{ fontSize: 9, color: '#C8940A', marginTop: 3, marginLeft: 16 }}>← choosing now</div>
                  )}
                  {!isDone && !isActive && idx > currentIdx && (
                    <div style={{ fontSize: 9, color: '#3a2810', marginTop: 2, marginLeft: 16 }}>waiting…</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Map picker */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {currentPlayer && (
              <HQMapPicker
                currentPlayer={{ id: currentPlayer.id, name: currentPlayer.name, factionId: factionPicks[currentPlayer.id] ?? 'enclave-of-the-bear' }}
                placedHQs={placedHQs}
                legacy={legacy}
                autoPick={askingAI}
                onConfirm={handleTerritoryPick}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'radial-gradient(ellipse at center, #1A0E04 0%, #080400 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Georgia, serif',
    }}>
      <div style={{
        background: 'linear-gradient(155deg, #1A0E02 0%, #0A0600 100%)',
        border: '2px solid rgba(200,148,10,0.60)',
        borderRadius: 14, padding: '28px 36px 24px',
        width: 640, maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto',
        color: '#E8DCC8',
        boxShadow: '0 16px 60px rgba(0,0,0,0.90)',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 'bold', color: '#C8940A', letterSpacing: 1.5 }}>
            {phaseTitle}
          </div>
          <div style={{ fontSize: 11, color: '#7a6040', marginTop: 4 }}>{phaseSubtitle}</div>
        </div>

        {/* Player order summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {players.map((p, idx) => {
            const fid = factionPicks[p.id]
            const tid = territoryPicks[p.id]
            const tName = tid ? (TERRITORY_DEFINITIONS.find(d => d.id === tid)?.name ?? tid) : null
            const color = fid ? hexToRgb(FACTION_COLORS[fid] ?? 0x888888) : 'rgb(100,80,50)'
            const isActive = idx === currentIdx
            const abilityId = fid ? (abilityPicks[fid] ?? existingAbilities[fid]) : undefined
            const abilityLabel = abilityName(abilityId)

            return (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 7,
                background: isActive ? 'rgba(200,148,10,0.08)' : 'rgba(0,0,0,0.25)',
                border: `1px solid ${isActive ? 'rgba(200,148,10,0.50)' : 'rgba(100,75,25,0.18)'}`,
              }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, border: SWATCH_RIM, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 13, color: isActive ? '#E8DCC8' : '#7a6040' }}>
                  {p.name}
                  {isActive && <span style={{ fontSize: 9, color: '#C8940A', marginLeft: 6 }}>← choosing now</span>}
                </div>
                <div style={{ fontSize: 11, color: '#9a8060', textAlign: 'right' }}>
                  {fid && <span style={{ color: factionNameRgb(fid) }}>{FACTION_NAMES[fid]}</span>}
                  {abilityLabel && phase !== 'faction' && (
                    <span style={{ color: '#27AE60', marginLeft: 6 }}>★ {abilityLabel}</span>
                  )}
                  {tName && <span style={{ color: '#27AE60', marginLeft: 6 }}>♛ {tName}</span>}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Faction selection (shared with the online screen) ── */}
        {phase === 'faction' && currentPlayer && (
          <FactionChoiceList
            legacy={legacy}
            existingAbilities={existingAbilities}
            removedAbilityIds={removedAbilityIds}
            takenFactionIds={takenFactions}
            pickerName={currentPlayer.name}
            onPick={handleFactionPick}
          />
        )}

        {/* ── Weakness power selection (alien milestone) ── */}
        {phase === 'weakness' && currentPlayer && currentFactionId && (
          <WeaknessPowerPicker
            playerName={currentPlayer.name}
            factionName={FACTION_NAMES[currentFactionId] ?? currentFactionId}
            takenPowerIds={new Set([
              ...Object.values(weaknessPicks),
              ...Object.values(legacy?.alienWeaknessPowers ?? {}),
            ])}
            onPick={handleWeaknessPick}
          />
        )}

        {/* ── Ability selection (shared with the online screen) ── */}
        {phase === 'ability' && currentPlayer && currentFactionId && (
          <AbilityChoicePair
            factionId={currentFactionId}
            pickerName={currentPlayer.name}
            onPick={id => handleAbilityPick(currentFactionId, id)}
          />
        )}

      </div>
    </div>
  )
}
