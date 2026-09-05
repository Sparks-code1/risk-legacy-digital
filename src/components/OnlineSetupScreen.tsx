import { useEffect, useRef, useState } from 'react'
import type { LegacyState } from '@/types/legacy'
import type { AuthUser } from '@/lib/auth'
import type { FactionId } from '@/types/faction'
import { getAbilitiesForFaction } from '@/data/factionAbilities'
import { needsWeaknessPower, WEAKNESS_POWERS } from '@/data/weaknessPowers'
import { TERRITORY_DEFINITIONS } from '@/data/territoryData'
import {
  type Lobby, subscribeLobby, publishSetup, submitChoice, leaveLobby,
} from '@/lib/lobby'
import {
  type SetupDoc, type SetupCtx, initialSetup, acceptRoll, applyPick,
  ingestChoices, expectedActor, awaitedRolls, turnKey,
} from '@/lib/setupFlow'
import {
  FactionChoiceList, AbilityChoicePair, FACTION_NAMES, factionRgb, abilityName,
  availableFactions, factionNameRgb, SWATCH_RIM,
} from './FactionChoicePanels'
import WeaknessPowerPicker from './WeaknessPowerPicker'
import HQMapPicker from './HQMapPicker'
import OnlineDraftBoard from './OnlineDraftBoard'

interface Props {
  /** The lobby AFTER reconciliation — seats carry real roster ids. */
  lobby: Lobby
  legacy: LegacyState
  user: AuthUser
  /** HOST only: every choice is in — build the board from the document. */
  onComplete: (doc: SetupDoc) => void
  /** JOINER only: the board went live on the server. */
  onActive: (lobby: Lobby) => void | Promise<string | null>
  onLeave: () => void
}

const GOLD = '#C8940A'
const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

/**
 * Game setup, played from every player's own screen.
 *
 * The HOST is the engine: it holds the authoritative document, applies its own
 * clicks (and the AI's) directly, folds in everyone else's declared choices as
 * they arrive, and publishes after every change. A JOINER renders the
 * published document, and when it is their die or their pick, writes a
 * declaration to their own seat row for the host to validate. Nobody else's
 * screen is ever just a spectator of a modal they cannot see.
 *
 * The rules themselves live in setupFlow — this file is transport and JSX.
 */
export default function OnlineSetupScreen({ lobby: initial, legacy, user, onComplete, onActive, onLeave }: Props) {
  const isHost = initial.createdBy === user.id
  const seats = [...initial.seats].sort((a, b) => a.seat - b.seat)
  const players = seats.map(s => s.playerId)

  // What the campaign says about factions — fixed for the whole setup.
  const ctxRef = useRef<SetupCtx>({
    players,
    existingAbilities: legacy.chosenFactionAbilities ?? {},
    availableFactions: availableFactions(legacy),
    abilityOptionIds: (fid: string) =>
      getAbilitiesForFaction(fid as FactionId)
        .filter(ab => !!ab && !(legacy.removedAbilityIds ?? []).includes(ab.id))
        .map(ab => ab!.id),
    needsWeakness: (fid: string) => needsWeaknessPower(fid, legacy),
    // A campaign that has unlocked the draft replaces the faction phase with
    // the draft board. It used to leave the online path entirely — the host
    // ran the hotseat draft and everyone else waited in the lobby.
    draft: !!legacy.draftOrderUnlocked,
  })

  const [doc, setDoc] = useState<SetupDoc>(initial.setup ?? initialSetup(players))
  const docRef = useRef(doc)
  const [error, setError] = useState<string | null>(null)
  /** Joiner's die, shown while it waits for the host to count it. */
  const [pendingRoll, setPendingRoll] = useState<{ round: number; roll: number } | null>(null)
  const completedRef = useRef(false)
  const activeRef = useRef(false)

  /** Host: adopt a new document, broadcast it, and finish when it is done. */
  function hostAdvance(next: SetupDoc) {
    if (next === docRef.current) return
    docRef.current = next
    setDoc(next)
    publishSetup(initial.matchId, next).catch(e =>
      setError(e instanceof Error ? e.message : 'Could not publish'))
    if (next.phase === 'done' && !completedRef.current) {
      completedRef.current = true
      onComplete(next)
    }
  }

  // The host announces the document the moment the screen opens, which is what
  // moves every joiner off the lobby and into setup.
  useEffect(() => {
    if (isHost && !initial.setup) {
      publishSetup(initial.matchId, docRef.current).catch(e =>
        setError(e instanceof Error ? e.message : 'Could not publish'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => subscribeLobby(initial.matchId, next => {
    if (!next) { onLeave(); return }
    if (isHost) {
      // Fold in everyone's declarations. My own and the AI's never travel —
      // they are applied directly below.
      const choices = Object.fromEntries(next.seats
        .filter(s => !s.isAI && s.userId !== user.id)
        .map(s => [s.playerId, s.choice]))
      hostAdvance(ingestChoices(docRef.current, ctxRef.current, choices))
      return
    }
    // A dead lobby ends the wait — the host cancelled, or their start failed
    // and the board is never coming. Waiting politely forever helps nobody.
    if (next.status === 'abandoned') { onLeave(); return }
    if (next.setup) {
      docRef.current = next.setup
      setDoc(next.setup)
    }
    if (next.status === 'active' && !activeRef.current) {
      activeRef.current = true
      void Promise.resolve(onActive(next)).then(err => {
        if (err) { activeRef.current = false; setError(err) }
      })
    }
  }), [initial.matchId])

  /**
   * A tie at the top voids the tied dice — so it voids my declaration too.
   *
   * This used to live inside the lobby subscription, which is created ONCE:
   * the callback closed over `pendingRoll` from the first render, where it is
   * null, so the clear could never fire. The joiner's screen kept showing
   * "counting…" for a die the host had already thrown away, the Roll button
   * stayed hidden behind that pending state, and the host waited for a roll
   * their opponent had no way left to send. An effect keyed on the round
   * cannot go stale that way.
   */
  useEffect(() => {
    setPendingRoll(p => (p && p.round !== doc.round ? null : p))
  }, [doc.round])

  // ── Who this machine speaks for ─────────────────────────────────────────
  const minePids = seats.filter(s => s.userId === user.id).map(s => s.playerId)
  const controlled = new Set([
    ...minePids,
    ...(isHost ? seats.filter(s => s.isAI).map(s => s.playerId) : []),
  ])
  const seatName = (pid: string) => seats.find(s => s.playerId === pid)?.name ?? pid

  function castRoll(pid: string) {
    const roll = Math.floor(Math.random() * 6) + 1
    if (isHost) {
      hostAdvance(acceptRoll(docRef.current, ctxRef.current, pid, roll, docRef.current.round))
    } else {
      setPendingRoll({ round: doc.round, roll })
      submitChoice(initial.matchId, { kind: 'roll', roll, round: doc.round })
        .catch(e => { setPendingRoll(null); setError(e instanceof Error ? e.message : 'Could not send your roll') })
    }
  }

  function castPick(value: string) {
    const actor = expectedActor(doc)
    if (!actor || !controlled.has(actor)) return
    if (isHost) {
      hostAdvance(applyPick(docRef.current, ctxRef.current, actor, value))
    } else {
      submitChoice(initial.matchId, { kind: 'pick', value, turnKey: turnKey(doc) })
        .catch(e => setError(e instanceof Error ? e.message : 'Could not send your pick'))
    }
  }

  const actor = expectedActor(doc)
  const iAct = !!actor && controlled.has(actor)
  const waiting = awaitedRolls(doc, ctxRef.current)

  /**
   * The computer players roll their own dice.
   *
   * They have no screen, so somebody's machine must throw for them, and it
   * was the host's — by hand, one button per AI, every round and again after
   * every tie. The host's machine still does the throwing; it just does not
   * wait to be asked. One at a time, with a beat between, so the table sees
   * each die land rather than three appearing at once.
   */
  useEffect(() => {
    if (!isHost || doc.phase !== 'dice') return
    const owed = seats.find(s => s.isAI && doc.rolls[s.playerId] === undefined)
    if (!owed) return
    const t = setTimeout(() => castRoll(owed.playerId), 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, doc.phase, doc.round, doc.rolls])

  // An AI seat never sees a screen — when the weakness phase lands on one, the
  // host's machine accepts the first unclaimed power for it instead of handing
  // the host (or anyone) the computer's choice. Other picks (faction, ability,
  // HQ) stay host decisions; a weakness is pure downside, nothing to weigh.
  const aiSeat = !!actor && !!seats.find(s => s.playerId === actor)?.isAI
  useEffect(() => {
    if (!isHost || doc.phase !== 'weakness' || !actor || !aiSeat) return
    const taken = new Set([
      ...Object.values(doc.weaknesses),
      ...Object.values(legacy.alienWeaknessPowers ?? {}),
    ])
    const pick = WEAKNESS_POWERS.find(p => !taken.has(p.id))
    if (pick) hostAdvance(applyPick(docRef.current, ctxRef.current, actor, pick.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, actor, aiSeat])

  // ── The draft gets the full-width board ─────────────────────────────────
  if (doc.phase === 'draft' && actor) {
    return (
      <OnlineDraftBoard
        doc={doc}
        legacy={legacy}
        actor={actor}
        iAct={iAct}
        minePids={minePids}
        seatName={seatName}
        isAI={(pid: string) => !!seats.find(s => s.playerId === pid)?.isAI}
        onClaim={castPick}
      />
    )
  }

  // ── Territory phase gets the full-width map layout ──────────────────────
  if (doc.phase === 'territory' && actor) {
    const placedHQs = Object.entries(doc.territories).map(([pid, tid]) => ({
      playerId: pid, playerName: seatName(pid),
      factionId: doc.factions[pid] ?? '', territoryId: tid,
    }))
    return (
      <div style={{
        width: '100vw', height: '100vh',
        background: 'radial-gradient(ellipse at center, #1A0E04 0%, #080400 100%)',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Georgia, serif', padding: '12px 16px', boxSizing: 'border-box', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: GOLD, letterSpacing: 1.5 }}>♛ PLACE YOUR HQ</div>
            <div style={{ fontSize: 11, color: '#7a6040', marginTop: 2 }}>
              In turn order, each player claims a starting territory — HQ + 8 troops
            </div>
          </div>
          <div style={{
            marginLeft: 'auto', padding: '6px 16px', borderRadius: 8, fontSize: 13, color: '#E8DCC8',
            background: 'rgba(200,148,10,0.10)', border: `1.5px solid ${factionRgb(doc.factions[actor])}`,
          }}>
            <span style={{ color: factionRgb(doc.factions[actor]), fontWeight: 'bold' }}>{seatName(actor)}</span>
            <span style={{ fontSize: 10, color: '#7a6040', marginLeft: 8 }}>
              {iAct ? 'your pick — choose on the map' : 'is choosing…'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
          <OrderStrip doc={doc} seatName={seatName} />
          <div style={{ flex: 1, minWidth: 0, opacity: iAct ? 1 : 0.55, pointerEvents: iAct ? 'auto' : 'none' }}>
            <HQMapPicker
              currentPlayer={{ id: actor, name: seatName(actor), factionId: doc.factions[actor] ?? 'enclave-of-the-bear' }}
              placedHQs={placedHQs}
              legacy={legacy}
              onConfirm={castPick}
            />
          </div>
        </div>
      </div>
    )
  }

  // ── Card layout for every other phase ───────────────────────────────────
  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'radial-gradient(ellipse at center, #1A0E04 0%, #080400 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif',
    }}>
      <div style={{
        background: 'linear-gradient(155deg, #1A0E02 0%, #0A0600 100%)',
        border: '2px solid rgba(200,148,10,0.60)', borderRadius: 14,
        padding: '26px 34px 22px', width: 640, maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto',
        color: '#E8DCC8', boxShadow: '0 16px 60px rgba(0,0,0,0.90)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 21, fontWeight: 'bold', color: GOLD, letterSpacing: 1.5 }}>
            {doc.phase === 'dice' ? '🎲 ROLL FOR FIRST'
              : doc.phase === 'faction' ? '⚑ CHOOSE YOUR FACTION'
              : doc.phase === 'weakness' ? '⚠ CHOOSE YOUR WEAKNESS POWER'
              : doc.phase === 'ability' ? '★ CHOOSE YOUR FACTION ABILITY'
              : '🎲 SETUP COMPLETE'}
          </div>
          <div style={{ fontSize: 11, color: '#7a6040', marginTop: 4 }}>
            {doc.phase === 'dice'
              ? 'Everyone rolls on their own screen · highest goes first · ties re-roll'
              : doc.phase === 'done'
                ? (isHost ? 'Building the board…' : 'The host is building the board — the game opens in a moment')
                : 'In turn order, each player chooses on their own screen'}
          </div>
        </div>

        {/* ── Dice ── */}
        {doc.phase === 'dice' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 6 }}>
            {doc.round > 1 && (
              <div style={{ fontSize: 11, color: '#e0a070', textAlign: 'center', marginBottom: 4 }}>
                ⚠ Tie at the top — round {doc.round}: tied players roll again
              </div>
            )}
            {seats.map(s => {
              const r = doc.rolls[s.playerId]
              const mineToRoll = controlled.has(s.playerId) && r === undefined
              const pendingMine = !isHost && minePids.includes(s.playerId) && pendingRoll && r === undefined
              return (
                <div key={s.playerId} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 15px', borderRadius: 8,
                  background: r !== undefined ? 'rgba(39,174,96,0.06)' : 'rgba(0,0,0,0.30)',
                  border: `1.5px solid ${r !== undefined ? 'rgba(39,174,96,0.30)' : 'rgba(100,75,25,0.22)'}`,
                }}>
                  <span style={{ width: 18, textAlign: 'center' }}>{s.isAI ? '🤖' : '🧑'}</span>
                  <span style={{ flex: 1, fontSize: 14 }}>
                    {s.name}
                    {minePids.includes(s.playerId) && <span style={{ fontSize: 10, color: '#6a5030' }}> (you)</span>}
                  </span>
                  <span style={{ fontSize: 34, width: 42, textAlign: 'center', lineHeight: 1 }}>
                    {r !== undefined ? DICE_FACES[r] : pendingMine ? DICE_FACES[pendingRoll!.roll] : '·'}
                  </span>
                  {mineToRoll && !pendingMine && (
                    <button onClick={() => castRoll(s.playerId)} style={{
                      padding: '6px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                      border: '1.5px solid rgba(200,148,10,0.55)', background: 'rgba(200,148,10,0.14)',
                      color: GOLD, fontFamily: 'Georgia, serif', fontWeight: 'bold',
                    }}>Roll</button>
                  )}
                  {pendingMine && <span style={{ fontSize: 10, color: '#7a6040' }}>counting…</span>}
                  {!mineToRoll && !pendingMine && r === undefined && (
                    <span style={{ fontSize: 10, color: '#6a5030' }}>waiting…</span>
                  )}
                </div>
              )
            })}
            {waiting.length === 0 ? null : (
              <div style={{ fontSize: 10.5, color: '#6a5030', textAlign: 'center', marginTop: 4 }}>
                Waiting for {waiting.map(seatName).join(', ')}
              </div>
            )}
          </div>
        )}

        {/* ── Turn order + picks so far ── */}
        {doc.phase !== 'dice' && doc.order && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
            {doc.order.map((pid, idx) => {
              const fid = doc.factions[pid]
              const isActive = actor === pid && doc.phase !== 'done'
              const abLabel = fid ? abilityName(doc.abilities[fid] ?? ctxRef.current.existingAbilities[fid]) : undefined
              const tid = doc.territories[pid]
              const tName = tid ? (TERRITORY_DEFINITIONS.find(d => d.id === tid)?.name ?? tid) : null
              return (
                <div key={pid} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', borderRadius: 7,
                  background: isActive ? 'rgba(200,148,10,0.08)' : 'rgba(0,0,0,0.25)',
                  border: `1px solid ${isActive ? 'rgba(200,148,10,0.50)' : 'rgba(100,75,25,0.18)'}`,
                }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: fid ? factionRgb(fid) : 'rgb(100,80,50)', border: SWATCH_RIM, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 13, color: isActive ? '#E8DCC8' : '#7a6040' }}>
                    {idx + 1}. {seatName(pid)}
                    {minePids.includes(pid) && <span style={{ fontSize: 9, color: '#6a5030' }}> (you)</span>}
                    {isActive && <span style={{ fontSize: 9, color: GOLD, marginLeft: 6 }}>← choosing now</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#9a8060', textAlign: 'right' }}>
                    {fid && <span style={{ color: factionNameRgb(fid) }}>{FACTION_NAMES[fid]}</span>}
                    {abLabel && <span style={{ color: '#27AE60', marginLeft: 6 }}>★ {abLabel}</span>}
                    {tName && <span style={{ color: '#27AE60', marginLeft: 6 }}>♛ {tName}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── The current pick, on the screen of whoever owns it ── */}
        {doc.phase === 'faction' && actor && (iAct ? (
          <FactionChoiceList
            legacy={legacy}
            existingAbilities={ctxRef.current.existingAbilities}
            removedAbilityIds={legacy.removedAbilityIds ?? []}
            takenFactionIds={Object.values(doc.factions)}
            pickerName={seatName(actor)}
            onPick={castPick}
          />
        ) : <WaitingOn name={seatName(actor)} what="to pick their faction" />)}

        {doc.phase === 'weakness' && actor && (iAct && !aiSeat ? (
          <WeaknessPowerPicker
            playerName={seatName(actor)}
            factionName={FACTION_NAMES[doc.factions[actor] ?? ''] ?? ''}
            takenPowerIds={new Set([
              ...Object.values(doc.weaknesses),
              ...Object.values(legacy.alienWeaknessPowers ?? {}),
            ])}
            onPick={castPick}
          />
        ) : <WaitingOn name={seatName(actor)} what="to accept a weakness power" />)}

        {doc.phase === 'ability' && actor && doc.factions[actor] && (iAct ? (
          <AbilityChoicePair
            factionId={doc.factions[actor]}
            pickerName={seatName(actor)}
            onPick={castPick}
          />
        ) : <WaitingOn name={seatName(actor)} what="to choose their faction ability" />)}

        {error && (
          <div style={{
            padding: '8px 12px', borderRadius: 6, marginTop: 12, fontSize: 11,
            background: 'rgba(231,76,60,0.10)', border: '1px solid rgba(231,76,60,0.40)', color: '#e08070',
          }}>
            {error}
          </div>
        )}

        <button
          onClick={() => { void leaveLobby(initial.matchId).catch(() => {}); onLeave() }}
          style={{
            width: '100%', marginTop: 14, padding: '8px', borderRadius: 7, fontSize: 10.5,
            border: '1px solid rgba(200,148,10,0.18)', background: 'transparent',
            color: '#5a4526', cursor: 'pointer', fontFamily: 'Georgia, serif',
          }}>
          {isHost ? '← Cancel this game' : '← Leave this game'}
        </button>
      </div>
    </div>
  )
}

function WaitingOn({ name, what }: { name: string; what: string }) {
  return (
    <div style={{
      padding: '22px 16px', borderRadius: 9, textAlign: 'center',
      background: 'rgba(0,0,0,0.25)', border: '1px dashed rgba(200,148,10,0.30)',
      fontSize: 13, color: '#9a8060',
    }}>
      ⏳ Waiting for <strong style={{ color: '#E8DCC8' }}>{name}</strong> {what} on their screen…
    </div>
  )
}

/** Sidebar order summary for the full-width territory layout. */
function OrderStrip({ doc, seatName }: { doc: SetupDoc; seatName: (pid: string) => string }) {
  if (!doc.order) return null
  return (
    <div style={{
      width: 180, flexShrink: 0,
      background: 'linear-gradient(155deg, #1A0E02 0%, #0A0600 100%)',
      border: '1.5px solid rgba(200,148,10,0.30)',
      borderRadius: 10, padding: '12px 10px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 9, color: '#5a4020', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Turn Order</div>
      {doc.order.map((pid, idx) => {
        const tid = doc.territories[pid]
        const tName = tid ? (TERRITORY_DEFINITIONS.find(d => d.id === tid)?.name ?? tid) : null
        const isActive = idx === doc.turnIdx && doc.phase === 'territory'
        return (
          <div key={pid} style={{
            padding: '7px 9px', borderRadius: 7,
            background: isActive ? 'rgba(200,148,10,0.08)' : 'rgba(0,0,0,0.25)',
            border: `1px solid ${isActive ? 'rgba(200,148,10,0.50)' : 'rgba(100,75,25,0.14)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: factionRgb(doc.factions[pid]), border: SWATCH_RIM, flexShrink: 0 }} />
              <div style={{ fontSize: 12, color: isActive ? '#E8DCC8' : tName ? '#9a8060' : '#4a3820', fontWeight: isActive ? 'bold' : 'normal' }}>
                {seatName(pid)}
              </div>
            </div>
            {tName && <div style={{ fontSize: 10, color: '#27AE60', marginTop: 3, marginLeft: 16 }}>♛ {tName}</div>}
            {isActive && !tName && <div style={{ fontSize: 9, color: GOLD, marginTop: 3, marginLeft: 16 }}>← choosing now</div>}
          </div>
        )
      })}
    </div>
  )
}
