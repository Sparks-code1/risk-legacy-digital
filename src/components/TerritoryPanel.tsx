import type { Territory } from '@/types/territory'
import type { Player } from '@/types/player'
import { FACTION_COLORS, NEUTRAL_COLOR } from '@/data/mockGameState'
import { CONTINENT_BONUSES } from '@/data/territoryData'

interface Props {
  territory: Territory | null
  players: Player[]
  onClose: () => void
}

function hexToRgb(hex: number) {
  return `rgb(${(hex >> 16) & 0xff},${(hex >> 8) & 0xff},${hex & 0xff})`
}

export default function TerritoryPanel({ territory, players, onClose }: Props) {
  if (!territory) return null

  const owner = players.find(p => p.id === territory.occupyingPlayerId)
  const ownerColor = owner ? hexToRgb(FACTION_COLORS[owner.factionId] ?? NEUTRAL_COLOR) : hexToRgb(NEUTRAL_COLOR)
  const continentBonus = CONTINENT_BONUSES[territory.continentId]

  return (
    <div style={{
      position: 'absolute',
      bottom: 24,
      right: 24,
      width: 280,
      // ABOVE THE HIT LAYER. The PixiJS canvas that does the board's hit
      // testing sits at z-index 3 and is transparent, so a panel with no
      // z-index of its own showed through it perfectly — and every click on
      // the panel, the × included, landed on the map underneath instead.
      zIndex: 20,
      background: 'rgba(15,10,5,0.92)',
      border: '1px solid rgba(200,180,120,0.35)',
      borderRadius: 8,
      padding: '16px 18px',
      color: '#e8dcc8',
      fontFamily: 'Georgia, serif',
      boxShadow: '0 4px 24px rgba(0,0,0,0.7)',
      pointerEvents: 'all',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 'bold', lineHeight: 1.2 }}>{territory.name}</div>
          <div style={{ fontSize: 11, color: '#a09070', marginTop: 2, textTransform: 'capitalize' }}>
            {territory.continentId.replace(/-/g, ' ')} · +{continentBonus} bonus
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close territory details"
          style={{ background: 'none', border: 'none', color: '#a09070', fontSize: 18, cursor: 'pointer', padding: '0 0 0 8px', lineHeight: 1 }}
        >×</button>
      </div>

      {/* Owner row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: ownerColor, flexShrink: 0 }} />
        <span style={{ fontSize: 13 }}>
          {owner ? `${owner.name} (${owner.factionId.replace(/-/g, ' ')})` : 'Unclaimed'}
        </span>
      </div>

      {/* Troops */}
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <span style={{ color: '#a09070' }}>Troops: </span>
        <span style={{ fontWeight: 'bold', fontSize: 15 }}>{territory.troops}</span>
      </div>

      {/* Scars */}
      {territory.scars.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#a09070', marginBottom: 4 }}>SCARS</div>
          {territory.scars.map((scar, i) => (
            <div key={i} style={{ fontSize: 12, color: '#e05050', textTransform: 'capitalize' }}>
              ⚠ {scar.type.replace(/-/g, ' ')} <span style={{ color: '#666' }}>(game {scar.appliedInGame})</span>
            </div>
          ))}
        </div>
      )}

      {/* Cities */}
      {territory.cities.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#a09070', marginBottom: 4 }}>CITIES</div>
          {territory.cities.map(city => (
            <div key={city.id} style={{ fontSize: 12, color: city.isDestroyed ? '#e05050' : '#e8dcc8' }}>
              {city.isDestroyed ? '☠' : '●'} {city.name}
              {city.isDestroyed && <span style={{ color: '#666' }}> (destroyed game {city.destroyedInGame})</span>}
              {city.headquartersFactionId && <span style={{ color: '#f39c12' }}> ★ HQ</span>}
            </div>
          ))}
        </div>
      )}

      {/* Adjacencies */}
      <div>
        <div style={{ fontSize: 11, color: '#a09070', marginBottom: 4 }}>BORDERS</div>
        <div style={{ fontSize: 11, lineHeight: 1.6, color: '#c0b090' }}>
          {territory.adjacentIds.map(id => id.replace(/-/g, ' ')).join(' · ')}
        </div>
      </div>
    </div>
  )
}
